/**
 * SEP-10: Stellar Web Authentication (client side).
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 *
 * The flow, one function per step:
 *   1. `discoverSep10Endpoint`  — read `WEB_AUTH_ENDPOINT` and `SIGNING_KEY` from the anchor's stellar.toml
 *   2. `fetchSep10Challenge`    — GET the challenge transaction for an account
 *   3. `verifySep10Challenge`   — check it before signing anything (server signature, home domain,
 *                                 web_auth_domain, time bounds, sequence 0, client account)
 *   4. the caller signs the challenge with the account's key (a wallet)
 *   5. `submitSep10Challenge`   — POST the signed challenge back for a JWT
 *
 * Verification is delegated to the SDK's `WebAuth.readChallengeTx`, which implements every
 * check the spec requires of a client, rather than re-implementing them here.
 *
 * Only classic `G...` accounts are covered; contract accounts (`C...`) use SEP-45 (`./sep45`).
 */

import { StellarToml, WebAuth } from '@stellar/stellar-sdk';

// ── Discovery ──────────────────────────────────────────────────────────────────

export interface Sep10Endpoint {
  /** The anchor's `WEB_AUTH_ENDPOINT`. */
  endpoint: string;
  /** The anchor's `SIGNING_KEY`: the account that must have signed the challenge. */
  serverSigningKey: string;
}

/**
 * Resolves `stellar.toml` for `homeDomain` and returns its SEP-10 fields.
 *
 * @throws if stellar.toml can't be resolved or lacks `WEB_AUTH_ENDPOINT` or `SIGNING_KEY`.
 */
export async function discoverSep10Endpoint(
  homeDomain: string,
  opts: { allowHttp?: boolean } = {},
): Promise<Sep10Endpoint> {
  const toml = await StellarToml.Resolver.resolve(homeDomain, { allowHttp: opts.allowHttp });
  const endpoint = toml.WEB_AUTH_ENDPOINT;
  const serverSigningKey = toml.SIGNING_KEY;
  if (!endpoint) {
    throw new Error(`discoverSep10Endpoint: "${homeDomain}" stellar.toml is missing WEB_AUTH_ENDPOINT.`);
  }
  if (!serverSigningKey) {
    throw new Error(`discoverSep10Endpoint: "${homeDomain}" stellar.toml is missing SIGNING_KEY.`);
  }
  return { endpoint, serverSigningKey };
}

// ── Challenge ──────────────────────────────────────────────────────────────────

export interface Sep10ChallengeRequest {
  endpoint: string;
  /** The `G...` account to authenticate. */
  account: string;
  homeDomain: string;
  /** Optional memo for shared (custodial) accounts. */
  memo?: string;
  /** Optional client domain, for anchors that verify wallets. */
  clientDomain?: string;
  fetchImpl?: typeof fetch;
}

export interface Sep10Challenge {
  /** The challenge transaction envelope, base64 XDR, exactly as the server sent it. */
  transaction: string;
  /** The network passphrase the server says it used, if it sent one. */
  networkPassphrase?: string;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Requests a challenge transaction for `account`.
 *
 * @throws on a non-2xx response (with the server's `error` when it sends one) or a missing `transaction`.
 */
export async function fetchSep10Challenge(req: Sep10ChallengeRequest): Promise<Sep10Challenge> {
  const { endpoint, account, homeDomain, memo, clientDomain, fetchImpl = fetch } = req;
  const url = new URL(endpoint);
  url.searchParams.set('account', account);
  url.searchParams.set('home_domain', homeDomain);
  if (memo) url.searchParams.set('memo', memo);
  if (clientDomain) url.searchParams.set('client_domain', clientDomain);

  const response = await fetchImpl(url.toString(), { method: 'GET' });
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`fetchSep10Challenge: server rejected the challenge request: ${message}`);
  }
  if (typeof body.transaction !== 'string' || !body.transaction) {
    throw new Error('fetchSep10Challenge: response is missing "transaction".');
  }
  return {
    transaction: body.transaction,
    networkPassphrase: typeof body.network_passphrase === 'string' ? body.network_passphrase : undefined,
  };
}

// ── Verification ───────────────────────────────────────────────────────────────

export interface Sep10VerifyParams {
  /** Challenge envelope, base64 XDR. */
  transaction: string;
  serverSigningKey: string;
  networkPassphrase: string;
  homeDomain: string;
  /** The account the client asked to authenticate; the challenge must be for it. */
  account: string;
  /** Host of `WEB_AUTH_ENDPOINT`. Defaults to the endpoint's hostname. */
  webAuthDomain: string;
}

/**
 * Verifies a challenge before anything signs it. `WebAuth.readChallengeTx` checks that the
 * server signed it, its sequence number is 0, its time bounds are current, its first operation
 * names `homeDomain`, and its `web_auth_domain` operation matches the endpoint's host. This adds
 * the check that the challenge is for the account that asked.
 *
 * @throws if any check fails.
 */
export function verifySep10Challenge(params: Sep10VerifyParams): void {
  const { transaction, serverSigningKey, networkPassphrase, homeDomain, account, webAuthDomain } = params;
  const { clientAccountID } = WebAuth.readChallengeTx(
    transaction,
    serverSigningKey,
    networkPassphrase,
    homeDomain,
    webAuthDomain,
  );
  if (clientAccountID !== account) {
    throw new Error(
      `verifySep10Challenge: challenge is for ${clientAccountID}, not the requested account ${account}.`,
    );
  }
}

// ── Token ──────────────────────────────────────────────────────────────────────

/**
 * Posts the signed challenge back and returns the JWT.
 *
 * @throws on a non-2xx response (with the server's `error` when it sends one) or a missing `token`.
 */
export async function submitSep10Challenge(req: {
  endpoint: string;
  /** The signed challenge envelope, base64 XDR. */
  transaction: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { endpoint, transaction, fetchImpl = fetch } = req;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(`submitSep10Challenge: server rejected the signed challenge: ${message}`);
  }
  if (typeof body.token !== 'string' || !body.token) {
    throw new Error('submitSep10Challenge: response is missing "token".');
  }
  return body.token;
}

/**
 * The `exp` claim of a JWT in milliseconds, or `null` if it has none. The signature is not
 * checked: the client only reads the expiry to know when to authenticate again.
 */
export function sep10TokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}
