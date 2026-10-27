/**
 * SEP-6: Deposit and Withdrawal API — client helpers for talking to an
 * anchor's SEP-6 `TRANSFER_SERVER`.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md
 *
 * Discovery follows the same pattern as `sep38.ts`: resolve `TRANSFER_SERVER`
 * from `stellar.toml` via `fetchStellarToml` (sep1.ts), then talk to that
 * server directly. Implements the client side of `GET /info`,
 * `GET /deposit`, `GET /withdraw` and `GET /transaction` — not the anchor
 * server, and not SEP-10 itself: pass a SEP-10 JWT as `authToken` (see
 * `sep45.ts` / your SEP-10 flow) for anchors that require authentication.
 */

import { fetchStellarToml } from "./sep1";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Sep6DiscoverOptions {
  allowHttp?: boolean;
}

/** A field the anchor asks the client to supply (`/info` `fields`, or a 403 `non_interactive_customer_info_needed`). */
export interface Sep6FieldInfo {
  description?: string;
  optional?: boolean;
  choices?: string[];
}

/** Fee/limit details shared by `/info` deposit and withdraw entries. */
interface Sep6AssetInfoBase {
  enabled: boolean;
  authenticationRequired: boolean;
  minAmount?: number;
  maxAmount?: number;
  feeFixed?: number;
  feePercent?: number;
}

export interface Sep6DepositAssetInfo extends Sep6AssetInfoBase {
  /** Extra fields the anchor needs for a deposit (e.g. `email_address`, `type`). */
  fields: Record<string, Sep6FieldInfo>;
}

export interface Sep6WithdrawAssetInfo extends Sep6AssetInfoBase {
  /** Withdrawal methods (e.g. `bank_account`, `cash`) and the fields each needs. */
  types: Record<string, { fields: Record<string, Sep6FieldInfo> }>;
}

/** Parsed `GET /info` response. */
export interface Sep6Info {
  /** Keyed by asset code. */
  deposit: Record<string, Sep6DepositAssetInfo>;
  /** Keyed by asset code. */
  withdraw: Record<string, Sep6WithdrawAssetInfo>;
  /** Feature flags, when the anchor reports them. */
  features?: { accountCreation?: boolean; claimableBalances?: boolean };
  /** The anchor's response as received, for fields not modelled here. */
  raw: Record<string, unknown>;
}

/** Amount/fee details shared by deposit and withdraw instructions. */
interface Sep6InstructionsBase {
  /** Anchor transaction id, usable with `fetchSep6Transaction`. */
  id?: string;
  /** Estimated seconds until the transfer completes. */
  eta?: number;
  minAmount?: number;
  maxAmount?: number;
  feeFixed?: number;
  feePercent?: number;
  extraInfo?: { message?: string };
}

/** A successful `GET /deposit`: how the user sends off-chain funds to the anchor. */
export interface Sep6DepositInstructions extends Sep6InstructionsBase {
  kind: "deposit";
  /** Human-readable deposit instructions (deprecated in SEP-6 but still common). */
  how?: string;
  /** Structured deposit instructions, keyed by SEP-9 field name. */
  instructions?: Record<string, { value: string; description: string }>;
}

/** A successful `GET /withdraw`: where the user sends the Stellar payment. */
export interface Sep6WithdrawInstructions extends Sep6InstructionsBase {
  kind: "withdraw";
  /** Stellar account to send the withdrawal payment to. */
  accountId?: string;
  memoType?: "text" | "id" | "hash";
  memo?: string;
}

/** 403 `non_interactive_customer_info_needed`: KYC fields must be sent via SEP-12 first. */
export interface Sep6CustomerInfoNeeded {
  kind: "customer_info_needed";
  /** SEP-9 field names the anchor needs. */
  fields: string[];
}

/** 403 `customer_info_status`: KYC was submitted and is pending or was denied. */
export interface Sep6CustomerInfoStatus {
  kind: "customer_info_status";
  status: "pending" | "denied" | string;
  moreInfoUrl?: string;
  eta?: number;
}

export type Sep6DepositResult =
  Sep6DepositInstructions | Sep6CustomerInfoNeeded | Sep6CustomerInfoStatus;

export type Sep6WithdrawResult =
  Sep6WithdrawInstructions | Sep6CustomerInfoNeeded | Sep6CustomerInfoStatus;

/** A SEP-6 transaction record from `GET /transaction`. Fields are snake_case as sent by the anchor. */
export interface Sep6Transaction {
  id: string;
  kind:
    | "deposit"
    | "withdrawal"
    | "deposit-exchange"
    | "withdrawal-exchange"
    | string;
  status: string;
  status_eta?: number;
  more_info_url?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  started_at?: string;
  completed_at?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  [key: string]: unknown;
}

interface Sep6RequestBase {
  /** The anchor's `TRANSFER_SERVER` URL (see `discoverSep6TransferServer`). */
  transferServer: string;
  /** SEP-10 JWT. Required by anchors whose `/info` reports `authentication_required`. */
  authToken?: string;
  fetchImpl?: typeof fetch;
}

export interface Sep6InfoRequest extends Sep6RequestBase {
  /** Language code (RFC 4646) for descriptions in the response. */
  lang?: string;
}

export interface Sep6DepositRequest extends Sep6RequestBase {
  /** Code of the on-chain asset the user wants to receive. */
  assetCode: string;
  /** Stellar account (G... or M...) that receives the deposit. */
  account: string;
  memoType?: "text" | "id" | "hash";
  memo?: string;
  emailAddress?: string;
  /** Deposit method, one of the anchor's `/info` `fields.type.choices`. */
  type?: string;
  amount?: string;
  walletName?: string;
  walletUrl?: string;
  lang?: string;
  claimableBalanceSupported?: boolean;
  customerId?: string;
}

export interface Sep6WithdrawRequest extends Sep6RequestBase {
  /** Code of the on-chain asset the user wants to withdraw. */
  assetCode: string;
  /** Withdrawal method, one of the anchor's `/info` `withdraw[asset].types`. */
  type: string;
  /** Stellar account the payment will be sent from. */
  account?: string;
  amount?: string;
  /** Deprecated in SEP-6 (use SEP-12), still accepted by many anchors. */
  dest?: string;
  destExtra?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
  walletName?: string;
  walletUrl?: string;
  lang?: string;
  refundMemo?: string;
  refundMemoType?: "text" | "id" | "hash";
  customerId?: string;
}

export interface Sep6TransactionRequest extends Sep6RequestBase {
  /** Anchor transaction id (from a deposit/withdraw response). */
  id: string;
}

export class Sep6Error extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Parsed error body from the anchor, when it sent JSON. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "Sep6Error";
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────────

/**
 * Resolves `TRANSFER_SERVER` from `homeDomain`'s `stellar.toml`.
 *
 * @throws if `stellar.toml` cannot be resolved, or is missing `TRANSFER_SERVER`.
 */
export async function discoverSep6TransferServer(
  homeDomain: string,
  opts: Sep6DiscoverOptions = {},
): Promise<string> {
  const toml = await fetchStellarToml(homeDomain, {
    allowHttp: opts.allowHttp,
  });
  const serverUrl = toml.TRANSFER_SERVER as string | undefined;
  if (!serverUrl) {
    throw new Sep6Error(
      `discoverSep6TransferServer: "${homeDomain}" stellar.toml is missing TRANSFER_SERVER.`,
    );
  }
  return serverUrl;
}

// ── Fetch ──────────────────────────────────────────────────────────────────────

interface Sep6RawResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

function baseUrl(transferServer: string): string {
  if (!transferServer || !transferServer.trim()) {
    throw new Sep6Error("SEP-6: transferServer is required.");
  }
  return transferServer.trim().replace(/\/+$/, "");
}

function buildQuery(
  params: Record<string, string | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Performs a SEP-6 GET and returns the status plus parsed JSON body without
 * throwing on 403, because SEP-6 uses 403 bodies to report KYC requirements.
 */
async function sep6Get(
  url: string,
  authToken: string | undefined,
  fetchImpl: typeof fetch | undefined,
): Promise<Sep6RawResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const doFetch = fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(url, { method: "GET", headers });
  } catch (err) {
    throw new Sep6Error(
      `SEP-6 request to "${url}" failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text().catch(() => "");
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new Sep6Error(
          `SEP-6 response from "${url}" was not valid JSON.`,
          response.status,
        );
      }
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  if (typeof body === "string" && body) return body;
  return fallback;
}

function assertOk(
  res: Sep6RawResponse,
  endpoint: string,
): Record<string, unknown> {
  if (!res.ok) {
    throw new Sep6Error(
      `SEP-6 ${endpoint} failed (${res.status}): ${errorMessage(res.body, "request rejected")}`,
      res.status,
      res.body,
    );
  }
  if (!res.body || typeof res.body !== "object") {
    throw new Sep6Error(
      `SEP-6 ${endpoint} returned an empty or non-object body.`,
      res.status,
    );
  }
  return res.body as Record<string, unknown>;
}

/** Maps a 403 KYC body to a result, or returns undefined if it is a plain error. */
function customerInfoResult(
  res: Sep6RawResponse,
): Sep6CustomerInfoNeeded | Sep6CustomerInfoStatus | undefined {
  if (res.status !== 403 || !res.body || typeof res.body !== "object")
    return undefined;
  const body = res.body as Record<string, unknown>;
  if (body.type === "non_interactive_customer_info_needed") {
    return {
      kind: "customer_info_needed",
      fields: Array.isArray(body.fields) ? (body.fields as string[]) : [],
    };
  }
  if (body.type === "customer_info_status") {
    return {
      kind: "customer_info_status",
      status: String(body.status ?? "pending"),
      moreInfoUrl: body.more_info_url as string | undefined,
      eta: body.eta as number | undefined,
    };
  }
  return undefined;
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

function instructionsBase(raw: Record<string, unknown>): Sep6InstructionsBase {
  return {
    id: raw.id as string | undefined,
    eta: num(raw.eta),
    minAmount: num(raw.min_amount),
    maxAmount: num(raw.max_amount),
    feeFixed: num(raw.fee_fixed),
    feePercent: num(raw.fee_percent),
    extraInfo: raw.extra_info as { message?: string } | undefined,
  };
}

function assetInfoBase(raw: Record<string, unknown>): Sep6AssetInfoBase {
  return {
    enabled: raw.enabled === true,
    authenticationRequired: raw.authentication_required === true,
    minAmount: num(raw.min_amount),
    maxAmount: num(raw.max_amount),
    feeFixed: num(raw.fee_fixed),
    feePercent: num(raw.fee_percent),
  };
}

function requireField(
  value: string | undefined,
  name: string,
  fn: string,
): void {
  if (!value || !value.trim()) {
    throw new Sep6Error(`${fn}: ${name} is required.`);
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Fetches `GET /info`: which assets the anchor supports for deposit and
 * withdrawal, their limits/fees, and the fields each needs.
 *
 * @throws {Sep6Error} on a non-2xx response, network failure, or malformed body.
 */
export async function fetchSep6Info(
  request: Sep6InfoRequest,
): Promise<Sep6Info> {
  const url = `${baseUrl(request.transferServer)}/info${buildQuery({ lang: request.lang })}`;
  const raw = assertOk(
    await sep6Get(url, request.authToken, request.fetchImpl),
    "/info",
  );

  const deposit: Record<string, Sep6DepositAssetInfo> = {};
  for (const [code, value] of Object.entries(
    (raw.deposit ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    deposit[code] = {
      ...assetInfoBase(value ?? {}),
      fields: (value?.fields ?? {}) as Record<string, Sep6FieldInfo>,
    };
  }

  const withdraw: Record<string, Sep6WithdrawAssetInfo> = {};
  for (const [code, value] of Object.entries(
    (raw.withdraw ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    withdraw[code] = {
      ...assetInfoBase(value ?? {}),
      types: (value?.types ?? {}) as Sep6WithdrawAssetInfo["types"],
    };
  }

  const rawFeatures = raw.features as Record<string, unknown> | undefined;
  return {
    deposit,
    withdraw,
    features: rawFeatures
      ? {
          accountCreation: rawFeatures.account_creation as boolean | undefined,
          claimableBalances: rawFeatures.claimable_balances as
            boolean | undefined,
        }
      : undefined,
    raw,
  };
}

/**
 * Initiates a deposit via `GET /deposit`.
 *
 * Returns deposit instructions on success, or — when the anchor answers 403
 * with a KYC body — a `customer_info_needed` / `customer_info_status` result
 * instead of throwing, so the UI can route the user to SEP-12 KYC.
 *
 * @throws {Sep6Error} on any other non-2xx response, network failure, or malformed body.
 */
export async function sep6Deposit(
  request: Sep6DepositRequest,
): Promise<Sep6DepositResult> {
  requireField(request.assetCode, "assetCode", "sep6Deposit");
  requireField(request.account, "account", "sep6Deposit");

  const url = `${baseUrl(request.transferServer)}/deposit${buildQuery({
    asset_code: request.assetCode,
    account: request.account,
    memo_type: request.memoType,
    memo: request.memo,
    email_address: request.emailAddress,
    type: request.type,
    amount: request.amount,
    wallet_name: request.walletName,
    wallet_url: request.walletUrl,
    lang: request.lang,
    claimable_balance_supported: request.claimableBalanceSupported,
    customer_id: request.customerId,
  })}`;

  const res = await sep6Get(url, request.authToken, request.fetchImpl);
  const kyc = customerInfoResult(res);
  if (kyc) return kyc;

  const raw = assertOk(res, "/deposit");
  return {
    kind: "deposit",
    ...instructionsBase(raw),
    how: raw.how as string | undefined,
    instructions: raw.instructions as Sep6DepositInstructions["instructions"],
  };
}

/**
 * Initiates a withdrawal via `GET /withdraw`.
 *
 * Returns the Stellar account (and memo) to pay on success, or a
 * `customer_info_needed` / `customer_info_status` result on a 403 KYC body.
 *
 * @throws {Sep6Error} on any other non-2xx response, network failure, or malformed body.
 */
export async function sep6Withdraw(
  request: Sep6WithdrawRequest,
): Promise<Sep6WithdrawResult> {
  requireField(request.assetCode, "assetCode", "sep6Withdraw");
  requireField(request.type, "type", "sep6Withdraw");

  const url = `${baseUrl(request.transferServer)}/withdraw${buildQuery({
    asset_code: request.assetCode,
    type: request.type,
    account: request.account,
    amount: request.amount,
    dest: request.dest,
    dest_extra: request.destExtra,
    memo: request.memo,
    memo_type: request.memoType,
    wallet_name: request.walletName,
    wallet_url: request.walletUrl,
    lang: request.lang,
    refund_memo: request.refundMemo,
    refund_memo_type: request.refundMemoType,
    customer_id: request.customerId,
  })}`;

  const res = await sep6Get(url, request.authToken, request.fetchImpl);
  const kyc = customerInfoResult(res);
  if (kyc) return kyc;

  const raw = assertOk(res, "/withdraw");
  return {
    kind: "withdraw",
    ...instructionsBase(raw),
    accountId: raw.account_id as string | undefined,
    memoType: raw.memo_type as Sep6WithdrawInstructions["memoType"],
    memo: raw.memo as string | undefined,
  };
}

/**
 * Fetches a single transaction's status via `GET /transaction?id=`.
 *
 * @throws {Sep6Error} on a non-2xx response (including 404 for an unknown id),
 * network failure, or a body without a `transaction` object.
 */
export async function fetchSep6Transaction(
  request: Sep6TransactionRequest,
): Promise<Sep6Transaction> {
  requireField(request.id, "id", "fetchSep6Transaction");
  const url = `${baseUrl(request.transferServer)}/transaction${buildQuery({ id: request.id })}`;
  const raw = assertOk(
    await sep6Get(url, request.authToken, request.fetchImpl),
    "/transaction",
  );
  const transaction = raw.transaction;
  if (!transaction || typeof transaction !== "object") {
    throw new Sep6Error(
      "SEP-6 /transaction response is missing the transaction object.",
    );
  }
  return transaction as Sep6Transaction;
}
