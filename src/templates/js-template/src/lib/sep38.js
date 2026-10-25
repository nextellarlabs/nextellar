/**
 * SEP-38: Anchor RFQ (quote) API — client helpers for requesting indicative
 * and firm quotes from a SEP-38 quote server.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md
 *
 * Discovery follows the same pattern as `sep30.ts`/`sep45.ts`: resolve
 * `ANCHOR_QUOTE_SERVER` from `stellar.toml` via `fetchStellarToml` (sep1.ts),
 * then talk to that server directly. This module implements the client side
 * only — `GET /prices`, `GET /price` (indicative), and `POST /quote` (firm)
 * — not the server side.
 */
import { fetchStellarToml } from "./sep1";
/**
 * Resolves `ANCHOR_QUOTE_SERVER` from `homeDomain`'s `stellar.toml`.
 *
 * @throws if `stellar.toml` cannot be resolved, or is missing `ANCHOR_QUOTE_SERVER`.
 */
export async function discoverSep38QuoteServer(homeDomain, opts = {}) {
    const toml = await fetchStellarToml(homeDomain, {
        allowHttp: opts.allowHttp,
    });
    const serverUrl = toml.ANCHOR_QUOTE_SERVER;
    if (!serverUrl) {
        throw new Error(`discoverSep38QuoteServer: "${homeDomain}" stellar.toml is missing ANCHOR_QUOTE_SERVER.`);
    }
    return serverUrl;
}
export class Sep38Error extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "Sep38Error";
    }
}
// ── Fetch ──────────────────────────────────────────────────────────────────────
async function sep38Fetch(url, init = {}) {
    const { authToken, fetchImpl, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (authToken) {
        headers.set("Authorization", `Bearer ${authToken}`);
    }
    const doFetch = fetchImpl ?? fetch;
    let response;
    try {
        response = await doFetch(url, { ...rest, headers });
    }
    catch (err) {
        throw new Sep38Error(`SEP-38 request to "${url}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Sep38Error(`SEP-38 request failed (${response.status}): ${detail}`, response.status);
    }
    let body;
    try {
        body = await response.json();
    }
    catch (err) {
        throw new Sep38Error(`SEP-38 response from "${url}" was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return body;
}
function buildQuery(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined)
            search.set(key, value);
    }
    return search.toString();
}
/**
 * Requests an **indicative** price via `GET /price`. Not binding — do not
 * pass the result to a transaction expecting a firm, executable quote.
 *
 * @throws {Sep38Error} on a non-2xx response, network failure, or malformed body.
 */
export async function fetchSep38IndicativePrice(request) {
    if (!request.sellAmount && !request.buyAmount) {
        throw new Sep38Error("fetchSep38IndicativePrice: exactly one of sellAmount or buyAmount is required.");
    }
    const query = buildQuery({
        sell_asset: request.sellAsset,
        buy_asset: request.buyAsset,
        sell_amount: request.sellAmount,
        buy_amount: request.buyAmount,
        context: request.context,
    });
    const base = request.quoteServer.replace(/\/$/, "");
    const raw = await sep38Fetch(`${base}/price?${query}`, {
        fetchImpl: request.fetchImpl,
    });
    return {
        kind: "indicative",
        sellAsset: request.sellAsset,
        buyAsset: request.buyAsset,
        price: raw.price,
        sellAmount: raw.sell_amount,
        buyAmount: raw.buy_amount,
    };
}
/**
 * Requests a **firm**, binding quote via `POST /quote`. The returned quote
 * is executable (referenced by `id`) until `expiresAt`.
 *
 * @throws {Sep38Error} on a non-2xx response, network failure, or malformed body.
 */
export async function fetchSep38FirmQuote(request) {
    if (!request.sellAmount && !request.buyAmount) {
        throw new Sep38Error("fetchSep38FirmQuote: exactly one of sellAmount or buyAmount is required.");
    }
    const base = request.quoteServer.replace(/\/$/, "");
    const raw = await sep38Fetch(`${base}/quote`, {
        method: "POST",
        authToken: request.authToken,
        fetchImpl: request.fetchImpl,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sell_asset: request.sellAsset,
            buy_asset: request.buyAsset,
            sell_amount: request.sellAmount,
            buy_amount: request.buyAmount,
            expire_after: request.expireAfter,
            context: request.context,
        }),
    });
    if (!raw.expires_at) {
        throw new Sep38Error("fetchSep38FirmQuote: server response is missing required expires_at.");
    }
    return {
        kind: "firm",
        id: raw.id,
        expiresAt: raw.expires_at,
        sellAsset: raw.sell_asset,
        buyAsset: raw.buy_asset,
        price: raw.price,
        sellAmount: raw.sell_amount,
        buyAmount: raw.buy_amount,
    };
}
