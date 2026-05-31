export interface AmountAsset {
  code: string;
  issuer?: string;
}

export interface AmountInput {
  amount: unknown;
  asset: AmountAsset;
}

export interface FieldError {
  field: "amount" | "asset";
  message: string;
}

export type AmountValidationResult =
  | { ok: true; amount: string; asset: AmountAsset }
  | { ok: false; errors: FieldError[] };

const NATIVE_CODE = "XLM";
const DEFAULT_PRECISION = 7;

const ASSET_PRECISION: Readonly<Record<string, number>> = Object.freeze({
  XLM: 7,
  USDC: 7,
  EURT: 4,
});

const ASSET_MAX_AMOUNT: Readonly<Record<string, string>> = Object.freeze({
  XLM: "922337203685.4775807",
  USDC: "922337203685.4775807",
  EURT: "922337203685.4775",
});

function normalizeAssetCode(code: string): string {
  return code.trim().toUpperCase();
}

export function precisionForAsset(code: string): number {
  const normalized = normalizeAssetCode(code);
  return ASSET_PRECISION[normalized] ?? DEFAULT_PRECISION;
}

export function maxAmountForAsset(code: string): string {
  const normalized = normalizeAssetCode(code);
  return ASSET_MAX_AMOUNT[normalized] ?? ASSET_MAX_AMOUNT.XLM;
}

function isValidAsset(asset: unknown): asset is AmountAsset {
  if (!asset || typeof asset !== "object") return false;
  const a = asset as AmountAsset;
  return typeof a.code === "string" && a.code.trim().length > 0;
}

function compareDecimalStrings(a: string, b: string): number {
  const [aw, af = ""] = a.split(".");
  const [bw, bf = ""] = b.split(".");
  if (aw.length !== bw.length) {
    return aw.length > bw.length ? 1 : -1;
  }
  const wholeCmp = aw.localeCompare(bw);
  if (wholeCmp !== 0) return wholeCmp;
  const scale = Math.max(af.length, bf.length);
  return af.padEnd(scale, "0").localeCompare(bf.padEnd(scale, "0"));
}

function decimalPlaces(value: string): number {
  const dot = value.indexOf(".");
  if (dot === -1) return 0;
  return value.length - dot - 1;
}

function parsePositiveDecimal(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: "amount must be a positive decimal string" };
  }
  if (/^0+(\.0+)?$/.test(trimmed)) {
    return { ok: false, reason: "amount must be greater than zero" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, reason: "amount must not be negative" };
  }
  return { ok: true, value: trimmed };
}

export function validatePaymentAmount(input: AmountInput): AmountValidationResult {
  const errors: FieldError[] = [];

  if (!isValidAsset(input.asset)) {
    errors.push({ field: "asset", message: "asset.code is required" });
    return { ok: false, errors };
  }

  const asset: AmountAsset = {
    code: normalizeAssetCode(input.asset.code),
    issuer: typeof input.asset.issuer === "string" ? input.asset.issuer.trim() : undefined,
  };

  if (asset.code !== NATIVE_CODE && !asset.issuer) {
    errors.push({ field: "asset", message: "asset.issuer is required for non-native assets" });
  }

  if (input.amount === undefined || input.amount === null || input.amount === "") {
    errors.push({ field: "amount", message: "amount is required" });
    return { ok: false, errors };
  }

  const raw =
    typeof input.amount === "number"
      ? input.amount.toString()
      : typeof input.amount === "string"
        ? input.amount
        : null;

  if (raw === null) {
    errors.push({ field: "amount", message: "amount must be a string or number" });
    return { ok: false, errors };
  }

  if (typeof input.amount === "number" && (input.amount <= 0 || !Number.isFinite(input.amount))) {
    errors.push({ field: "amount", message: "amount must be a positive finite number" });
    return { ok: false, errors };
  }

  const parsed = parsePositiveDecimal(raw);
  if (!parsed.ok) {
    errors.push({ field: "amount", message: parsed.reason });
    return { ok: false, errors };
  }

  const precision = precisionForAsset(asset.code);
  if (decimalPlaces(parsed.value) > precision) {
    errors.push({
      field: "amount",
      message: `amount exceeds ${precision} decimal places for ${asset.code}`,
    });
    return { ok: false, errors };
  }

  const max = maxAmountForAsset(asset.code);
  if (compareDecimalStrings(parsed.value, max) > 0) {
    errors.push({ field: "amount", message: `amount exceeds maximum for ${asset.code}` });
    return { ok: false, errors };
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, amount: parsed.value, asset };
}

export function amountErrorsToBody(errors: FieldError[]): { errors: FieldError[] } {
  return { errors };
}
