import { Asset } from '@stellar/stellar-sdk';

/**
 * Pure helpers for path payments (DEX swaps): asset conversion, slippage
 * bounds and Horizon path-record parsing. Amounts are handled as BigInt
 * stroops (1 unit = 10^7 stroops) so slippage maths never loses precision to
 * floating point.
 */

export type SwapAsset = 'XLM' | { code: string; issuer: string };

/** One hop-by-hop route returned by Horizon path finding. */
export type PathQuote = {
  sourceAsset: SwapAsset;
  sourceAmount: string;
  destinationAsset: SwapAsset;
  destinationAmount: string;
  /** Intermediate assets the payment is routed through (excludes endpoints). */
  path: SwapAsset[];
};

// BigInt() rather than literals: the template targets ES2017.
export const STROOPS_PER_UNIT = BigInt(10000000);
const ZERO = BigInt(0);
const BPS_DENOMINATOR = BigInt(10000);
const BPS_ROUNDING = BigInt(9999);
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
export const MAX_SLIPPAGE_BPS = 5000; // 50%

const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

export function toAsset(asset: SwapAsset): Asset {
  return asset === 'XLM' ? Asset.native() : new Asset(asset.code, asset.issuer);
}

export function assetLabel(asset: SwapAsset): string {
  return asset === 'XLM' ? 'XLM' : asset.code;
}

export function sameAsset(a: SwapAsset, b: SwapAsset): boolean {
  if (a === 'XLM' || b === 'XLM') return a === b;
  return a.code === b.code && a.issuer === b.issuer;
}

export function isValidAmount(amount: string): boolean {
  return AMOUNT_PATTERN.test(amount) && toStroops(amount) > ZERO;
}

export function toStroops(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(7, '0'));
}

export function fromStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_UNIT;
  const fraction = (stroops % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

function assertSlippage(slippageBps: number): void {
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > MAX_SLIPPAGE_BPS
  ) {
    throw new Error(
      `Slippage must be a whole number of basis points between 0 and ${MAX_SLIPPAGE_BPS}`,
    );
  }
}

/**
 * Strict-send: the sender fixes what they spend, so slippage protects the
 * amount received. Returns the minimum destination amount (`destMin`),
 * rounded up so the guarantee is never looser than requested.
 */
export function minReceiveAmount(
  estimatedDestination: string,
  slippageBps: number,
): string {
  assertSlippage(slippageBps);
  const estimate = toStroops(estimatedDestination);
  const keep = BPS_DENOMINATOR - BigInt(slippageBps);
  const min = (estimate * keep + BPS_ROUNDING) / BPS_DENOMINATOR;
  return fromStroops(min);
}

/**
 * Strict-receive: the recipient amount is fixed, so slippage caps what the
 * sender may spend. Returns the maximum send amount (`sendMax`), rounded up.
 */
export function maxSendAmount(
  estimatedSource: string,
  slippageBps: number,
): string {
  assertSlippage(slippageBps);
  const estimate = toStroops(estimatedSource);
  const max =
    (estimate * (BPS_DENOMINATOR + BigInt(slippageBps)) + BPS_ROUNDING) /
    BPS_DENOMINATOR;
  return fromStroops(max);
}

type HorizonAssetFields = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};

function parseHorizonAsset(fields: HorizonAssetFields): SwapAsset {
  if (fields.asset_type === 'native') return 'XLM';
  if (!fields.asset_code || !fields.asset_issuer) {
    throw new Error('Malformed asset in Horizon path response');
  }
  return { code: fields.asset_code, issuer: fields.asset_issuer };
}

/** Shape of a record from Horizon's strict-send / strict-receive path endpoints. */
export type HorizonPathRecord = {
  source_asset_type: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  source_amount: string;
  destination_asset_type: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  destination_amount: string;
  path: HorizonAssetFields[];
};

export function parsePathRecord(record: HorizonPathRecord): PathQuote {
  return {
    sourceAsset: parseHorizonAsset({
      asset_type: record.source_asset_type,
      asset_code: record.source_asset_code,
      asset_issuer: record.source_asset_issuer,
    }),
    sourceAmount: record.source_amount,
    destinationAsset: parseHorizonAsset({
      asset_type: record.destination_asset_type,
      asset_code: record.destination_asset_code,
      asset_issuer: record.destination_asset_issuer,
    }),
    destinationAmount: record.destination_amount,
    path: (record.path ?? []).map(parseHorizonAsset),
  };
}

/** Human-readable route, e.g. "XLM → USDC → EURC". */
export function describePath(quote: PathQuote): string {
  return [quote.sourceAsset, ...quote.path, quote.destinationAsset]
    .map(assetLabel)
    .join(' → ');
}

/**
 * Pick the best route from Horizon's candidates: for strict-send the one that
 * delivers the most; for strict-receive the one that costs the least.
 */
export function selectBestPath(
  quotes: PathQuote[],
  mode: 'strict-send' | 'strict-receive',
): PathQuote | null {
  if (quotes.length === 0) return null;
  return quotes.reduce((best, quote) => {
    if (mode === 'strict-send') {
      return toStroops(quote.destinationAmount) >
        toStroops(best.destinationAmount)
        ? quote
        : best;
    }
    return toStroops(quote.sourceAmount) < toStroops(best.sourceAmount)
      ? quote
      : best;
  });
}
