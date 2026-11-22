/**
 * SEP-30: Account Recovery - client helpers for recovery signer servers.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md
 *
 * Implements the dApp/client side: discovery via `stellar.toml`, registering
 * an account with a recovery server, and requesting recovery signatures.
 */

import { StellarToml } from '@stellar/stellar-sdk';

async function sep30Fetch(url, init = {}) {
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
    return await response.json();
}

/**
 * Resolve `RECOVERY_SIGNER` (and optional `SIGNING_KEY`) from `stellar.toml`.
 *
 * @param {string} homeDomain
 * @param {{allowHttp?: boolean}} [opts]
 * @returns {Promise<{serverUrl: string, signingKey?: string}>}
 */
export async function discoverSep30RecoveryServer(homeDomain, opts = {}) {
    const toml = await StellarToml.Resolver.resolve(homeDomain, {
        allowHttp: opts.allowHttp,
    });
    const serverUrl = toml.RECOVERY_SIGNER;
    if (!serverUrl) {
        throw new Error(`discoverSep30RecoveryServer: "${homeDomain}" stellar.toml is missing RECOVERY_SIGNER.`);
    }
    return { serverUrl, signingKey: toml.SIGNING_KEY };
}

/**
 * Register (or update) recovery signers for `accountId` on a SEP-30 server.
 *
 * @param {{serverUrl: string, accountId: string, authToken: string, signers: string[]}} request
 * @returns {Promise<void>}
 */
export async function registerSep30Account(request) {
    const base = request.serverUrl.replace(/\/$/, '');
    await sep30Fetch(`${base}/accounts/${request.accountId}/signers`, {
        method: 'POST',
        authToken: request.authToken,
        body: JSON.stringify({ signers: request.signers }),
    });
}

/**
 * Request a signed recovery transaction from the SEP-30 server.
 *
 * @param {{serverUrl: string, accountId: string, recoveryToken: string}} request
 * @returns {Promise<{transaction: string}>}
 */
export async function recoverSep30Account(request) {
    const base = request.serverUrl.replace(/\/$/, '');
    return sep30Fetch(`${base}/accounts/${request.accountId}/recover`, {
        method: 'POST',
        body: JSON.stringify({ recovery_token: request.recoveryToken }),
    });
}
