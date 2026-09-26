/**
 * SEP-45: Stellar Web Authentication for Contract Accounts.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md
 *
 * SEP-45 is the Soroban contract-account (`C...`) analog of SEP-10's classic
 * account (`G...`/`M...`) web auth: instead of signing a dummy Stellar
 * transaction, the client signs a `SorobanAuthorizationEntry` invoking a
 * well-known `web_auth_verify` function on a `WEB_AUTH_CONTRACT_ID` contract.
 *
 * This module implements the **client side** of the flow only:
 *   1. `discoverSep45Endpoint`  — resolve `stellar.toml` for the auth endpoint/contract/server key
 *   2. `fetchSep45Challenge`    — GET the challenge (signed authorization entries) from the server
 *   3. `verifySep45Challenge`   — validate the challenge before signing anything (steps a client MUST do per spec)
 *   4. `signSep45ClientEntry`   — sign the client's entry with `authorizeEntry`
 *   5. `submitSep45Token`       — POST the signed entries back for a session JWT
 *
 * It does not implement the server side (challenge issuance/verification),
 * nor the on-chain `web_auth_verify` contract itself — both are server/infra
 * concerns outside a frontend toolkit's scope.
 */

import {
  authorizeEntry,
  xdr,
  Address,
  Keypair,
  StellarToml,
  type SigningCallback,
} from '@stellar/stellar-sdk';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import jsXdr from '@stellar/js-xdr';

const { XdrReader, XdrWriter } = jsXdr;
// See `src/types/stellar-js-xdr.d.ts` for why this ambient declaration exists
// and why `xdr.SorobanAuthorizationEntry[]` is encoded/decoded by hand below.

// ── Discovery ──────────────────────────────────────────────────────────────────

export interface Sep45Endpoint {
  /** The server's `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` — where the challenge/token requests are sent. */
  endpoint: string;
  /** The `WEB_AUTH_CONTRACT_ID` (`C...`) — the on-chain contract every authorization entry must target. */
  contractId: string;
  /** The server's `SIGNING_KEY` (`G...`) — the "Server Account" whose signature must appear on the challenge. */
  serverSigningKey: string;
}

/**
 * Resolves `stellar.toml` for `homeDomain` and extracts the SEP-45 fields
 * (`WEB_AUTH_FOR_CONTRACTS_ENDPOINT`, `WEB_AUTH_CONTRACT_ID`, `SIGNING_KEY`).
 *
 * @throws if `stellar.toml` cannot be resolved, or is missing any of the three required fields.
 */
export async function discoverSep45Endpoint(
  homeDomain: string,
  opts: { allowHttp?: boolean } = {},
): Promise<Sep45Endpoint> {
  const toml = await StellarToml.Resolver.resolve(homeDomain, { allowHttp: opts.allowHttp });

  const endpoint = toml.WEB_AUTH_FOR_CONTRACTS_ENDPOINT as string | undefined;
  const contractId = toml.WEB_AUTH_CONTRACT_ID as string | undefined;
  const serverSigningKey = toml.SIGNING_KEY;

  if (!endpoint) {
    throw new Error(`discoverSep45Endpoint: "${homeDomain}" stellar.toml is missing WEB_AUTH_FOR_CONTRACTS_ENDPOINT.`);
  }
  if (!contractId) {
    throw new Error(`discoverSep45Endpoint: "${homeDomain}" stellar.toml is missing WEB_AUTH_CONTRACT_ID.`);
  }
  if (!serverSigningKey) {
    throw new Error(`discoverSep45Endpoint: "${homeDomain}" stellar.toml is missing SIGNING_KEY.`);
  }

  return { endpoint, contractId, serverSigningKey };
}

// ── Challenge ──────────────────────────────────────────────────────────────────

export interface Sep45ChallengeRequest {
  /** The `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` URL to request the challenge from. */
  endpoint: string;
  /** The Client Account address (`C...`) requesting authentication. */
  account: string;
  /** The Home Domain the client wishes to authenticate with. */
  homeDomain: string;
  /** Optional Client Domain, for servers that support Client Domain verification. */
  clientDomain?: string;
  /** Injectable fetch implementation, defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface Sep45Challenge {
  /** Decoded authorization entries returned by the server (client + server [+ client domain] entries). */
  entries: xdr.SorobanAuthorizationEntry[];
  /** Raw XDR-encoded entries exactly as returned, re-used unmodified when submitting back to `token`. */
  raw: string;
  /** Network passphrase the server reports using, if provided. */
  networkPassphrase?: string;
}

/**
 * Decodes a base64 XDR-encoded `SorobanAuthorizationEntry[]` (a standard XDR
 * variable-length array: a `uint32` element count followed by each entry's
 * own XDR encoding back-to-back).
 *
 * @throws if the buffer is malformed or contains trailing bytes past the declared entries.
 */
function decodeSorobanAuthorizationEntries(raw: string): xdr.SorobanAuthorizationEntry[] {
  const reader = new XdrReader(Buffer.from(raw, 'base64'));
  const count = xdr.Uint32.read(reader);
  const entries: xdr.SorobanAuthorizationEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(xdr.SorobanAuthorizationEntry.read(reader));
  }
  if (!reader.eof) {
    throw new Error('decodeSorobanAuthorizationEntries: buffer has unexpected trailing bytes.');
  }
  return entries;
}

/**
 * Encodes a `SorobanAuthorizationEntry[]` back into the base64 XDR
 * variable-length array format `decodeSorobanAuthorizationEntries` reads.
 */
function encodeSorobanAuthorizationEntries(entries: xdr.SorobanAuthorizationEntry[]): string {
  const writer = new XdrWriter();
  xdr.Uint32.write(entries.length, writer);
  for (const entry of entries) {
    xdr.SorobanAuthorizationEntry.write(entry, writer);
  }
  return writer.finalize().toString('base64');
}

/**
 * Requests a SEP-45 challenge from the server and decodes the returned
 * `SorobanAuthorizationEntries` XDR.
 *
 * @throws on a non-2xx response (using the server's `error` field when present), or if the response is missing `authorization_entries`.
 */
export async function fetchSep45Challenge(req: Sep45ChallengeRequest): Promise<Sep45Challenge> {
  const { endpoint, account, homeDomain, clientDomain, fetchImpl = fetch } = req;

  const url = new URL(endpoint);
  url.searchParams.set('account', account);
  url.searchParams.set('home_domain', homeDomain);
  if (clientDomain) url.searchParams.set('client_domain', clientDomain);

  const response = await fetchImpl(url.toString(), { method: 'GET' });
  const body = await response.json().catch(() => ({}) as Record<string, unknown>);

  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`fetchSep45Challenge: server rejected challenge request: ${message}`);
  }

  const raw = body?.authorization_entries as string | undefined;
  if (!raw) {
    throw new Error('fetchSep45Challenge: response is missing "authorization_entries".');
  }

  const entries = decodeSorobanAuthorizationEntries(raw);

  return { entries, raw, networkPassphrase: body?.network_passphrase as string | undefined };
}

// ── Verification ───────────────────────────────────────────────────────────────

/** A decoded view of a `web_auth_verify` entry's `args` map, all values as strings per spec. */
export interface Sep45ChallengeArgs {
  account: string;
  home_domain: string;
  web_auth_domain: string;
  web_auth_domain_account: string;
  nonce: string;
  client_domain?: string;
  client_domain_account?: string;
}

function decodeArgsMap(entry: xdr.SorobanAuthorizationEntry): Sep45ChallengeArgs {
  const invocation = entry.rootInvocation();
  const fn = invocation.function();
  if (fn.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') {
    throw new Error('verifySep45Challenge: authorization entry is not a contract function invocation.');
  }

  const contractFn = fn.contractFn();
  const argsVal = contractFn.args()[0];
  if (!argsVal || argsVal.switch().name !== 'scvMap') {
    throw new Error('verifySep45Challenge: expected a single ScMap argument.');
  }

  const map = argsVal.map() ?? [];
  const result: Record<string, string> = {};
  for (const entryKV of map) {
    const key = entryKV.key();
    const val = entryKV.val();
    const keyStr = key.switch().name === 'scvSymbol' ? key.sym().toString() : key.str().toString();
    result[keyStr] = val.switch().name === 'scvString' ? val.str().toString() : val.sym().toString();
  }

  if (!result.account || !result.home_domain || !result.web_auth_domain || !result.web_auth_domain_account || !result.nonce) {
    throw new Error('verifySep45Challenge: authorization entry args are missing required fields.');
  }

  return result as unknown as Sep45ChallengeArgs;
}

export interface VerifySep45ChallengeOptions {
  /** The `WEB_AUTH_CONTRACT_ID` from the server's stellar.toml — every entry's `contract_address` must match this. */
  contractId: string;
  /** The `SIGNING_KEY` (Server Account) from the server's stellar.toml. */
  serverSigningKey: string;
  /** The Home Domain the client requested authentication for. */
  homeDomain: string;
  /** The Server's own domain (may differ from the Home Domain). */
  webAuthDomain: string;
  /** The Client Account address that was requested. */
  account: string;
  /** Client Domain, if one was included in the challenge request. */
  clientDomain?: string;
}

/**
 * Performs the client-side verification steps SEP-45 requires **before**
 * signing anything (spec "authentication flow", steps 4-9):
 * - every entry has no sub-invocations
 * - every entry's `contract_address` matches `WEB_AUTH_CONTRACT_ID`
 * - every entry's function is `web_auth_verify`
 * - the `args` map matches across all entries and matches the expected values
 * - there is an entry credentialed to the Server Account
 * - there is an entry credentialed to the Client Account
 *
 * Does **not** verify the Server Account's cryptographic signature itself —
 * that requires simulating/executing against the network (SEP-45 step: "the
 * Client simulates the transaction... to ensure no unintended side
 * effects"), which is left to the caller since it needs a configured RPC
 * client. This function only performs the structural/args checks that are
 * pure functions of the challenge payload.
 *
 * @throws with a message identifying which check failed.
 * @returns the shared, verified args map (useful for reading `nonce`, etc.)
 */
export function verifySep45Challenge(
  challenge: Sep45Challenge,
  opts: VerifySep45ChallengeOptions,
): Sep45ChallengeArgs {
  const { contractId, serverSigningKey, homeDomain, webAuthDomain, account, clientDomain } = opts;

  if (challenge.entries.length === 0) {
    throw new Error('verifySep45Challenge: challenge contains no authorization entries.');
  }

  let sharedArgs: Sep45ChallengeArgs | undefined;
  let hasServerEntry = false;
  let hasClientEntry = false;

  for (const entry of challenge.entries) {
    const invocation = entry.rootInvocation();

    if ((invocation.subInvocations() ?? []).length > 0) {
      throw new Error('verifySep45Challenge: authorization entry must not contain sub-invocations.');
    }

    const fn = invocation.function();
    if (fn.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') {
      throw new Error('verifySep45Challenge: authorization entry is not a contract function invocation.');
    }
    const contractFn = fn.contractFn();

    const functionName = contractFn.functionName().toString();
    if (functionName !== 'web_auth_verify') {
      throw new Error(`verifySep45Challenge: expected function "web_auth_verify", got "${functionName}".`);
    }

    const args = decodeArgsMap(entry);

    if (!sharedArgs) {
      sharedArgs = args;
    } else {
      const keys: (keyof Sep45ChallengeArgs)[] = [
        'account', 'home_domain', 'web_auth_domain', 'web_auth_domain_account', 'nonce',
        'client_domain', 'client_domain_account',
      ];
      for (const key of keys) {
        if (sharedArgs[key] !== args[key]) {
          throw new Error(`verifySep45Challenge: "${key}" differs across authorization entries.`);
        }
      }
    }

  }

  if (!sharedArgs) {
    throw new Error('verifySep45Challenge: could not extract shared args from challenge.');
  }

  if (sharedArgs.account !== account) {
    throw new Error('verifySep45Challenge: "account" does not match the requested Client Account.');
  }
  if (sharedArgs.home_domain !== homeDomain) {
    throw new Error('verifySep45Challenge: "home_domain" does not match the expected Home Domain.');
  }
  if (sharedArgs.web_auth_domain !== webAuthDomain) {
    throw new Error('verifySep45Challenge: "web_auth_domain" does not match the expected Server domain.');
  }
  if (sharedArgs.web_auth_domain_account !== serverSigningKey) {
    throw new Error('verifySep45Challenge: "web_auth_domain_account" does not match the Server Account.');
  }
  if (clientDomain && sharedArgs.client_domain !== clientDomain) {
    throw new Error('verifySep45Challenge: "client_domain" does not match the requested Client Domain.');
  }

  for (const entry of challenge.entries) {
    const credentials = entry.credentials();
    if (credentials.switch().name !== 'sorobanCredentialsAddress') continue;

    const addressCredentials = credentials.address();
    const scAddress = addressCredentials.address();
    const holderAddress = scAddressToString(scAddress);

    if (holderAddress === serverSigningKey) {
      if (addressCredentials.signature().switch().name === 'scvVoid') {
        throw new Error('verifySep45Challenge: Server Account entry is missing a signature.');
      }
      hasServerEntry = true;
    }
    if (holderAddress === account) {
      hasClientEntry = true;
    }
  }

  if (!hasServerEntry) {
    throw new Error('verifySep45Challenge: no authorization entry is credentialed to the Server Account.');
  }
  if (!hasClientEntry) {
    throw new Error('verifySep45Challenge: no authorization entry is credentialed to the Client Account.');
  }

  // Verify every entry's contract_address matches WEB_AUTH_CONTRACT_ID.
  for (const entry of challenge.entries) {
    const contractFn = entry.rootInvocation().function().contractFn();
    const entryContractAddress = scAddressToString(contractFn.contractAddress());
    if (entryContractAddress !== contractId) {
      throw new Error('verifySep45Challenge: authorization entry "contract_address" does not match WEB_AUTH_CONTRACT_ID.');
    }
  }

  return sharedArgs;
}

/** Converts an `xdr.ScAddress` to its StrKey string (`G...`, `M...`, or `C...`). */
function scAddressToString(scAddress: xdr.ScAddress): string {
  return Address.fromScAddress(scAddress).toString();
}

// ── Signing ────────────────────────────────────────────────────────────────────

export interface SignSep45ChallengeOptions {
  /** The Client Account address (`C...`) whose entry should be signed. */
  clientAccount: string;
  /**
   * Signer for the Client Account's authorization entry: either a `Keypair`
   * (DEV-ONLY — never use a raw secret key in production) or a
   * `SigningCallback` that delegates to a wallet/hardware signer.
   */
  signer: Keypair | SigningCallback;
  /** Network passphrase to sign against. */
  networkPassphrase: string;
  /** Ledger sequence after which the signature is no longer valid. */
  validUntilLedgerSeq: number;
}

/**
 * Signs the authorization entry belonging to `clientAccount` within a SEP-45
 * challenge, leaving the other entries (Server Account, optional Client
 * Domain) untouched. Callers should run `verifySep45Challenge` first.
 *
 * @returns the full entry list with the client's entry replaced by its signed version, ready for `submitSep45Token`.
 * @throws if no entry in the challenge is credentialed to `clientAccount`.
 *
 * @security
 * ⚠️ Passing a `Keypair` built from a raw secret key is for DEVELOPMENT ONLY.
 * In production, pass a `SigningCallback` that delegates to a secure wallet
 * adapter so the secret key never enters application memory.
 */
export async function signSep45ClientEntry(
  challenge: Sep45Challenge,
  opts: SignSep45ChallengeOptions,
): Promise<xdr.SorobanAuthorizationEntry[]> {
  const { clientAccount, signer, networkPassphrase, validUntilLedgerSeq } = opts;

  const index = challenge.entries.findIndex((entry) => {
    const credentials = entry.credentials();
    if (credentials.switch().name !== 'sorobanCredentialsAddress') return false;
    return scAddressToString(credentials.address().address()) === clientAccount;
  });

  if (index === -1) {
    throw new Error('signSep45ClientEntry: no authorization entry is credentialed to the given Client Account.');
  }

  const signedEntry = await authorizeEntry(
    challenge.entries[index],
    signer,
    validUntilLedgerSeq,
    networkPassphrase,
  );

  const entries = [...challenge.entries];
  entries[index] = signedEntry;
  return entries;
}

// ── Token exchange ───────────────────────────────────────────────────────────────

export interface SubmitSep45TokenRequest {
  /** The `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` URL to submit the signed challenge to. */
  endpoint: string;
  /** The full set of authorization entries, with the Client (and optional Client Domain) entries signed. */
  entries: xdr.SorobanAuthorizationEntry[];
  /** Injectable fetch implementation, defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Submits the signed authorization entries to the SEP-45 `token` endpoint
 * and returns the resulting session JWT.
 *
 * @throws on a non-2xx response (using the server's `error` field when present).
 */
export async function submitSep45Token(req: SubmitSep45TokenRequest): Promise<string> {
  const { endpoint, entries, fetchImpl = fetch } = req;

  const raw = encodeSorobanAuthorizationEntries(entries);

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorization_entries: raw }),
  });

  const body = await response.json().catch(() => ({}) as Record<string, unknown>);

  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`submitSep45Token: server rejected the signed challenge: ${message}`);
  }

  const token = body?.token as string | undefined;
  if (!token) {
    throw new Error('submitSep45Token: response is missing "token".');
  }

  return token;
}
