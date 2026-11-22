/**
 * SEP-24: Hosted Deposit and Withdrawal - client helpers for the interactive
 * flow, where the anchor collects KYC/payment details in a popup or iframe.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
 *
 * Flow:
 *   1. `discoverSep24TransferServer(homeDomain)` -> `TRANSFER_SERVER_SEP0024`
 *   2. `startSep24Interactive(...)` -> POST /transactions/{deposit|withdraw}/interactive
 *      with a SEP-10 JWT -> `{ url, id }`
 *   3. Open `url` (popup or iframe) with `callback=postMessage` appended, so
 *      the anchor posts transaction updates back to the opener/parent window.
 *   4. `parseSep24Message()` validates each message (origin + transaction id);
 *      `fetchSep24Transaction()` polls GET /transaction as a fallback when
 *      the anchor doesn't post messages or the user closes the window.
 *
 * Client side only. Pair with `useSep24Interactive`.
 */

import { fetchStellarToml } from './sep1';

/** Statuses after which the transaction can no longer change. */
export const SEP24_TERMINAL_STATUSES = new Set([
    'completed',
    'refunded',
    'expired',
    'no_market',
    'too_small',
    'too_large',
    'error',
]);

/** Statuses where the interactive part is done and the wallet must act or wait. */
export const SEP24_INTERACTIVE_DONE_STATUSES = new Set([
    'pending_user_transfer_start',
    'pending_user_transfer_complete',
    'pending_external',
    'pending_anchor',
    'pending_stellar',
    'pending_trust',
    'pending_user',
]);

export class Sep24Error extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'Sep24Error';
        this.status = status;
    }
}

// ── Discovery ──────────────────────────────────────────────────────────────────

/**
 * Resolves `TRANSFER_SERVER_SEP0024` from `homeDomain`'s `stellar.toml`.
 *
 * @param {string} homeDomain
 * @param {{allowHttp?: boolean}} [opts]
 * @returns {Promise<string>}
 * @throws if `stellar.toml` cannot be resolved or lacks TRANSFER_SERVER_SEP0024.
 */
export async function discoverSep24TransferServer(homeDomain, opts = {}) {
    const toml = await fetchStellarToml(homeDomain, { allowHttp: opts.allowHttp });
    const server = toml.TRANSFER_SERVER_SEP0024;
    if (!server) {
        throw new Sep24Error(
            `discoverSep24TransferServer: "${homeDomain}" stellar.toml is missing TRANSFER_SERVER_SEP0024.`,
        );
    }
    return server;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function joinUrl(base, path) {
    return `${base.replace(/\/+$/, '')}${path}`;
}

/**
 * Parse and check an anchor-provided URL. Only https is accepted, except
 * http://localhost for local anchors. This blocks javascript:/data: URLs from
 * being opened in a popup or iframe.
 *
 * @param {string} raw
 * @returns {URL}
 */
export function assertSafeInteractiveUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Sep24Error(`Anchor returned an invalid interactive URL: ${String(raw).slice(0, 80)}`);
    }
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
        throw new Sep24Error(`Anchor interactive URL must use https (got ${url.protocol}).`);
    }
    return url;
}

async function readError(res) {
    try {
        const body = await res.json();
        if (body?.error) return body.error;
    }
    catch {
        /* fall through */
    }
    return res.statusText || `HTTP ${res.status}`;
}

// ── Interactive flow ───────────────────────────────────────────────────────────

/**
 * POST /transactions/{deposit|withdraw}/interactive.
 *
 * @param {{transferServer: string, kind: 'deposit'|'withdraw', authToken: string, assetCode: string, assetIssuer?: string, account?: string, amount?: string, lang?: string, extra?: Record<string,string>, fetchImpl?: typeof fetch}} params
 * @throws {Sep24Error} on HTTP errors, an unexpected response type, or an unsafe URL.
 */
export async function startSep24Interactive(params) {
    const { transferServer, kind, authToken, assetCode, fetchImpl = fetch } = params;
    if (kind !== 'deposit' && kind !== 'withdraw') {
        throw new Sep24Error('startSep24Interactive: kind must be "deposit" or "withdraw".');
    }
    if (!authToken) throw new Sep24Error('startSep24Interactive: a SEP-10 authToken is required.');
    if (!assetCode) throw new Sep24Error('startSep24Interactive: assetCode is required.');

    const body = { asset_code: assetCode };
    if (params.assetIssuer) body.asset_issuer = params.assetIssuer;
    if (params.account) body.account = params.account;
    if (params.amount) body.amount = params.amount;
    if (params.lang) body.lang = params.lang;
    Object.assign(body, params.extra ?? {});

    const res = await fetchImpl(joinUrl(transferServer, `/transactions/${kind}/interactive`), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Sep24Error(`SEP-24 ${kind} request failed: ${await readError(res)}`, res.status);
    }

    const json = await res.json();
    if (json.type !== 'interactive_customer_info_needed' || !json.url || !json.id) {
        throw new Sep24Error('SEP-24: anchor did not return an interactive URL.');
    }
    assertSafeInteractiveUrl(json.url);
    return { type: json.type, url: json.url, id: json.id };
}

/**
 * Append `callback=postMessage` (and `lang`) so the anchor posts updates to
 * the window that opened it.
 *
 * @param {string} url
 * @param {{lang?: string}} [opts]
 * @returns {string}
 */
export function buildSep24InteractiveUrl(url, opts = {}) {
    const parsed = assertSafeInteractiveUrl(url);
    parsed.searchParams.set('callback', 'postMessage');
    if (opts.lang) parsed.searchParams.set('lang', opts.lang);
    return parsed.toString();
}

/**
 * GET /transaction?id=... - current state of a SEP-24 transaction.
 *
 * @param {{transferServer: string, authToken: string, id: string, fetchImpl?: typeof fetch}} params
 */
export async function fetchSep24Transaction(params) {
    const { transferServer, authToken, id, fetchImpl = fetch } = params;
    const url = `${joinUrl(transferServer, '/transaction')}?id=${encodeURIComponent(id)}`;
    const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
        throw new Sep24Error(`SEP-24 transaction lookup failed: ${await readError(res)}`, res.status);
    }
    const json = await res.json();
    if (!json.transaction?.id) {
        throw new Sep24Error('SEP-24: transaction response is missing `transaction`.');
    }
    return json.transaction;
}

/**
 * Validate a `message` event posted by the anchor's interactive page.
 *
 * Returns the transaction only when the event came from the anchor's origin
 * and refers to the expected transaction id; anything else (other origins,
 * other windows, unrelated messages) returns null and must be ignored.
 *
 * @param {{origin: string, data: unknown}} event
 * @param {{origin: string, transactionId: string}} expected
 */
export function parseSep24Message(event, expected) {
    if (event.origin !== expected.origin) return null;
    let data = event.data;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    const tx = data?.transaction;
    if (!tx || typeof tx !== 'object' || typeof tx.status !== 'string') return null;
    if (tx.id !== expected.transactionId) return null;
    return tx;
}

export function isSep24Terminal(status) {
    return !!status && SEP24_TERMINAL_STATUSES.has(status);
}

/** True once the user has finished the anchor's interactive form. */
export function isSep24InteractiveComplete(status) {
    return isSep24Terminal(status) || (!!status && SEP24_INTERACTIVE_DONE_STATUSES.has(status));
}
