/**
 * SEP-30: Account Recovery — client helpers for recovery signer servers.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md
 *
 * Implements the dApp/client side: discovery via `stellar.toml`, registering
 * an account with a recovery server, and requesting recovery signatures.
 */

import { StellarToml } from '@stellar/stellar-sdk';

export interface Sep30RecoveryServer {
  /** Base URL of the SEP-30 recovery server (from `RECOVERY_SIGNER` in stellar.toml). */
  serverUrl: string;
  /** Optional `SIGNING_KEY` advertised by the recovery domain. */
  signingKey?: string;
}

export interface Sep30RegisterRequest {
  serverUrl: string;
  accountId: string;
  /** Bearer or SEP-10 JWT authorizing the registration request. */
  authToken: string;
  /** Recovery signers to register (G-addresses). */
  signers: string[];
}

export interface Sep30RecoverRequest {
  serverUrl: string;
  accountId: string;
  /** Share / challenge material returned by the recovery server. */
  recoveryToken: string;
}

export interface Sep30RecoverResponse {
  transaction: string;
}

async function sep30Fetch<T>(
  url: string,
  init: RequestInit & { authToken?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.authToken) {
    headers.set('Authorization', `Bearer ${init.authToken}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`SEP-30 request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * Resolve `RECOVERY_SIGNER` (and optional `SIGNING_KEY`) from `stellar.toml`.
 */
export async function discoverSep30RecoveryServer(
  homeDomain: string,
  opts: { allowHttp?: boolean } = {},
): Promise<Sep30RecoveryServer> {
  const toml = await StellarToml.Resolver.resolve(homeDomain, {
    allowHttp: opts.allowHttp,
  });
  const serverUrl = toml.RECOVERY_SIGNER as string | undefined;
  if (!serverUrl) {
    throw new Error(
      `discoverSep30RecoveryServer: "${homeDomain}" stellar.toml is missing RECOVERY_SIGNER.`,
    );
  }
  return { serverUrl, signingKey: toml.SIGNING_KEY };
}

/**
 * Register (or update) recovery signers for `accountId` on a SEP-30 server.
 */
export async function registerSep30Account(
  request: Sep30RegisterRequest,
): Promise<void> {
  const base = request.serverUrl.replace(/\/$/, '');
  await sep30Fetch(`${base}/accounts/${request.accountId}/signers`, {
    method: 'POST',
    authToken: request.authToken,
    body: JSON.stringify({ signers: request.signers }),
  });
}

/**
 * Request a signed recovery transaction from the SEP-30 server.
 */
export async function recoverSep30Account(
  request: Sep30RecoverRequest,
): Promise<Sep30RecoverResponse> {
  const base = request.serverUrl.replace(/\/$/, '');
  return sep30Fetch<Sep30RecoverResponse>(
    `${base}/accounts/${request.accountId}/recover`,
    {
      method: 'POST',
      body: JSON.stringify({ recovery_token: request.recoveryToken }),
    },
  );
}
