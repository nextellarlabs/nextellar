/**
 * SEP-2: Federation protocol — resolve `name*domain.com` addresses to a
 * Stellar account id plus an optional memo the recipient requires
 * (issue #950).
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md
 *
 * Flow: `domain` → `stellar.toml` (sep1.ts) → `FEDERATION_SERVER` →
 * `GET {FEDERATION_SERVER}?q=name*domain&type=name`.
 *
 * The response is checked strictly: the account id must be a valid G… key,
 * and the returned memo must match its declared type. Federation hash memos
 * arrive base64-encoded and are converted to hex for `lib/memo.ts`.
 */

import { StrKey } from "@stellar/stellar-sdk";
import { fetchStellarToml } from "./sep1";
import { validateMemo, type PaymentMemo } from "./memo";

export interface FederationRecord {
  /** The address that was resolved, as returned by the server. */
  stellarAddress: string;
  accountId: string;
  /** Memo the recipient requires. When present, payments MUST carry it. */
  memo?: PaymentMemo;
}

export type Sep2ErrorCode =
  | "INVALID_ADDRESS"
  | "NO_FEDERATION_SERVER"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "INVALID_RESPONSE"
  | "TIMEOUT";

export class Sep2Error extends Error {
  readonly code: Sep2ErrorCode;
  constructor(code: Sep2ErrorCode, message: string) {
    super(message);
    this.name = "Sep2Error";
    this.code = code;
  }
}

// name: anything except `*`, `>` and whitespace; domain: a hostname with a dot.
const FEDERATION_ADDRESS_RE =
  /^([^*>\s]+)\*((?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))+)$/;

/** True when `value` looks like `name*domain.tld`. */
export function isFederationAddress(value: string): boolean {
  return FEDERATION_ADDRESS_RE.test(value.trim());
}

export function splitFederationAddress(value: string): { name: string; domain: string } {
  const match = FEDERATION_ADDRESS_RE.exec(value.trim());
  if (!match) {
    throw new Sep2Error("INVALID_ADDRESS", `"${value}" is not a federation address (expected name*domain.com).`);
  }
  return { name: match[1], domain: match[2].toLowerCase() };
}

export interface ResolveFederationOptions {
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 10000). */
  timeoutMs?: number;
  /** Allow http FEDERATION_SERVER / stellar.toml (local testing only). */
  allowHttp?: boolean;
  signal?: AbortSignal;
}

/** Base64 (standard or URL-safe) to lowercase hex. Uses `atob`, so no Buffer polyfill is needed in the browser. */
function base64ToHex(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    let hex = "";
    for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
    return hex;
  } catch {
    return null;
  }
}

function normalizeMemo(memoType: unknown, memo: unknown): PaymentMemo | undefined {
  if (memoType === undefined || memoType === null || memoType === "" || memoType === "none") return undefined;
  if (memo === undefined || memo === null || memo === "") {
    throw new Sep2Error("INVALID_RESPONSE", "Federation server declared a memo type but sent no memo.");
  }
  const raw = String(memo);
  let value: PaymentMemo;
  if (memoType === "text") value = { type: "text", value: raw };
  else if (memoType === "id") value = { type: "id", value: raw };
  else if (memoType === "hash") {
    // SEP-2: hash memos are base64-encoded. Accept 64-char hex too, which some servers send.
    const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : base64ToHex(raw);
    if (hex === null) throw new Sep2Error("INVALID_RESPONSE", "Federation server returned a hash memo that is not valid base64.");
    value = { type: "hash", value: hex };
  } else {
    throw new Sep2Error("INVALID_RESPONSE", `Federation server returned an unsupported memo type "${String(memoType)}".`);
  }
  const error = validateMemo(value.type, value.value);
  if (error) throw new Sep2Error("INVALID_RESPONSE", `Federation server returned an invalid memo: ${error}`);
  return value;
}

/**
 * Resolve a federation address.
 *
 * @throws Sep2Error with a `code` the UI can map to a message.
 */
export async function resolveFederationAddress(
  address: string,
  opts: ResolveFederationOptions = {},
): Promise<FederationRecord> {
  const { fetchImpl = fetch, timeoutMs = 10_000, allowHttp = false } = opts;
  const { name, domain } = splitFederationAddress(address);
  const query = `${name}*${domain}`;

  let server: string | undefined;
  try {
    const toml = await fetchStellarToml(domain, { allowHttp, timeout: timeoutMs });
    server = toml.FEDERATION_SERVER as string | undefined;
  } catch {
    throw new Sep2Error("NO_FEDERATION_SERVER", `Could not load stellar.toml for ${domain}.`);
  }
  if (!server) {
    throw new Sep2Error("NO_FEDERATION_SERVER", `${domain} does not publish a FEDERATION_SERVER.`);
  }

  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new Sep2Error("NO_FEDERATION_SERVER", `${domain} publishes an invalid FEDERATION_SERVER.`);
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Sep2Error("NO_FEDERATION_SERVER", `${domain}'s FEDERATION_SERVER must use https.`);
  }
  url.searchParams.set("q", query);
  url.searchParams.set("type", "name");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !opts.signal?.aborted) {
      throw new Sep2Error("TIMEOUT", `Federation server for ${domain} did not respond in time.`);
    }
    throw err instanceof Error && err.name === "AbortError"
      ? err
      : new Sep2Error("SERVER_ERROR", `Could not reach the federation server for ${domain}.`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  if (res.status === 404) {
    throw new Sep2Error("NOT_FOUND", `${query} was not found.`);
  }
  if (!res.ok) {
    throw new Sep2Error("SERVER_ERROR", `Federation server for ${domain} returned HTTP ${res.status}.`);
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Sep2Error("INVALID_RESPONSE", "Federation server returned invalid JSON.");
  }

  const accountId = body.account_id;
  if (typeof accountId !== "string" || !StrKey.isValidEd25519PublicKey(accountId)) {
    throw new Sep2Error("INVALID_RESPONSE", "Federation server returned an invalid account id.");
  }
  const returned = typeof body.stellar_address === "string" ? body.stellar_address : query;
  if (returned.toLowerCase() !== query.toLowerCase()) {
    throw new Sep2Error("INVALID_RESPONSE", "Federation server answered for a different address.");
  }

  return {
    stellarAddress: returned,
    accountId,
    memo: normalizeMemo(body.memo_type, body.memo),
  };
}
