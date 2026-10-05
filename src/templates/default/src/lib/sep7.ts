/**
 * SEP-7: URI Scheme to facilitate delegated signing (`web+stellar:`).
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 *
 * Implements the `pay` operation only (requesting a payment/transaction
 * signature for a destination, amount, and optional asset) — the other
 * SEP-7 operation, `tx` (submit an arbitrary pre-built transaction XDR), is
 * out of scope for this helper. `pay` is what `ReceiveForm` needs: encoding
 * a payment *request* (as opposed to a bare address) into a scannable
 * QR/deep-link.
 *
 * This is a pure string-encoding/parsing helper with no network calls — it
 * does not fetch `origin_domain` verification signatures or submit anything.
 */

const SEP7_SCHEME = 'web+stellar';

/** Fields accepted by the `pay` operation, per SEP-7 §Operations. */
export interface Sep7PayParams {
  /** Destination account (`G...`) or contract (`C...`) address that will receive the payment. Required. */
  destination: string;
  /** Amount the destination will receive, as a decimal string (e.g. "10.5"). */
  amount?: string;
  /**
   * Asset the destination will receive. Native XLM is represented by
   * `undefined`/omitted. A non-native asset requires both `code` and `issuer`.
   */
  asset?: { code: string; issuer: string };
  /** Memo to attach to the transaction. */
  memo?: string;
  /** Memo type: `MEMO_TEXT` (default when `memo` is set), `MEMO_ID`, `MEMO_HASH`, or `MEMO_RETURN`. */
  memoType?: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH' | 'MEMO_RETURN';
  /** URL the signed transaction should be POSTed to instead of submitted directly to the network. */
  callback?: string;
  /** Human-readable message to show the user in their wallet (max 300 chars per spec). */
  msg?: string;
  /** Network passphrase, if not the public network default. */
  networkPassphrase?: string;
  /** Fully qualified domain name of the origin requesting the payment (for SEP-7 signature verification). */
  originDomain?: string;
  /** Base64-encoded signature of the URI, produced by the `origin_domain`'s `URI_REQUEST_SIGNING_KEY`. */
  signature?: string;
}

const MAX_MSG_LENGTH = 300;

/**
 * Builds a `web+stellar:pay` URI from structured payment parameters.
 *
 * @throws if `destination` is missing, or `asset.code`/`asset.issuer` is
 *   partially specified, or `msg` exceeds SEP-7's 300-character limit.
 *
 * @example
 * ```ts
 * buildSep7PayUri({ destination: 'GABC...', amount: '10', asset: { code: 'USDC', issuer: 'GISSUER...' } });
 * // "web+stellar:pay?destination=GABC...&amount=10&asset_code=USDC&asset_issuer=GISSUER..."
 *
 * buildSep7PayUri({ destination: 'GABC...' });
 * // "web+stellar:pay?destination=GABC..." (native XLM, no amount specified)
 * ```
 */
export function buildSep7PayUri(params: Sep7PayParams): string {
  const { destination, amount, asset, memo, memoType, callback, msg, networkPassphrase, originDomain, signature } =
    params;

  if (!destination || destination.trim().length === 0) {
    throw new Error('buildSep7PayUri: "destination" is required.');
  }

  if (asset && (!asset.code || !asset.issuer)) {
    throw new Error('buildSep7PayUri: "asset" requires both "code" and "issuer".');
  }

  if (msg && msg.length > MAX_MSG_LENGTH) {
    throw new Error(
      `buildSep7PayUri: "msg" must be at most ${MAX_MSG_LENGTH} characters (got ${msg.length}).`,
    );
  }

  const query = new URLSearchParams();
  query.set('destination', destination);

  if (amount !== undefined) query.set('amount', amount);
  if (asset) {
    query.set('asset_code', asset.code);
    query.set('asset_issuer', asset.issuer);
  }
  if (memo !== undefined) query.set('memo', memo);
  if (memoType !== undefined) query.set('memo_type', memoType);
  if (callback !== undefined) query.set('callback', callback);
  if (msg !== undefined) query.set('msg', msg);
  if (networkPassphrase !== undefined) query.set('network_passphrase', networkPassphrase);
  if (originDomain !== undefined) query.set('origin_domain', originDomain);
  if (signature !== undefined) query.set('signature', signature);

  return `${SEP7_SCHEME}:pay?${query.toString()}`;
}

/** Parsed representation of a SEP-7 `pay` URI. */
export interface ParsedSep7PayUri extends Sep7PayParams {
  operation: 'pay';
}

/**
 * Parses a `web+stellar:pay` URI back into structured parameters.
 *
 * Accepts both the spec-compliant single-slash form (`web+stellar:pay?...`)
 * and the common double-slash variant some clients emit
 * (`web+stellar://pay?...`).
 *
 * @throws if the URI does not use the `web+stellar` scheme, is not a `pay`
 *   operation, or is missing the required `destination` parameter.
 *
 * @example
 * ```ts
 * parseSep7PayUri('web+stellar:pay?destination=GABC...&amount=10');
 * // { operation: 'pay', destination: 'GABC...', amount: '10' }
 * ```
 */
export function parseSep7PayUri(uri: string): ParsedSep7PayUri {
  if (!uri || typeof uri !== 'string') {
    throw new Error('parseSep7PayUri: expected a non-empty string.');
  }

  const match = uri.match(/^web\+stellar:\/{0,2}(\w+)\??(.*)$/i);
  if (!match) {
    throw new Error(`parseSep7PayUri: not a valid "web+stellar:" URI: "${uri}"`);
  }

  const [, operation, queryString] = match;
  if (operation.toLowerCase() !== 'pay') {
    throw new Error(`parseSep7PayUri: expected a "pay" operation, got "${operation}".`);
  }

  const query = new URLSearchParams(queryString);
  const destination = query.get('destination');
  if (!destination) {
    throw new Error('parseSep7PayUri: URI is missing the required "destination" parameter.');
  }

  const assetCode = query.get('asset_code');
  const assetIssuer = query.get('asset_issuer');
  if ((assetCode && !assetIssuer) || (!assetCode && assetIssuer)) {
    throw new Error('parseSep7PayUri: "asset_code" and "asset_issuer" must both be present or both absent.');
  }

  const result: ParsedSep7PayUri = {
    operation: 'pay',
    destination,
  };

  const amount = query.get('amount');
  if (amount !== null) result.amount = amount;

  if (assetCode && assetIssuer) {
    result.asset = { code: assetCode, issuer: assetIssuer };
  }

  const memo = query.get('memo');
  if (memo !== null) result.memo = memo;

  const memoType = query.get('memo_type');
  if (memoType !== null) {
    if (!['MEMO_TEXT', 'MEMO_ID', 'MEMO_HASH', 'MEMO_RETURN'].includes(memoType)) {
      throw new Error(`parseSep7PayUri: invalid "memo_type": "${memoType}".`);
    }
    result.memoType = memoType as Sep7PayParams['memoType'];
  }

  const callback = query.get('callback');
  if (callback !== null) result.callback = callback;

  const msg = query.get('msg');
  if (msg !== null) result.msg = msg;

  const networkPassphrase = query.get('network_passphrase');
  if (networkPassphrase !== null) result.networkPassphrase = networkPassphrase;

  const originDomain = query.get('origin_domain');
  if (originDomain !== null) result.originDomain = originDomain;

  const signature = query.get('signature');
  if (signature !== null) result.signature = signature;

  return result;
}

/**
 * True if `value` looks like a SEP-7 `web+stellar:` URI (any operation),
 * without fully parsing or validating it. Useful for branching between
 * "is this a plain address" vs "is this a SEP-7 request" before calling the
 * stricter `parseSep7PayUri`.
 */
export function isSep7Uri(value: string): boolean {
  return typeof value === 'string' && /^web\+stellar:/i.test(value);
}
