import {
  Address,
  Asset,
  FeeBumpTransaction,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

export interface AssetSummary {
  code: string;
  issuer?: string;
  isNative: boolean;
}

export interface BaseOperationSummary {
  type: string;
  summary: string;
  source?: string;
}

export interface CreateAccountSummary extends BaseOperationSummary {
  type: 'createAccount';
  destination: string;
  startingBalance: string;
}

export interface PaymentSummary extends BaseOperationSummary {
  type: 'payment';
  destination: string;
  asset: AssetSummary;
  amount: string;
}

export interface PathPaymentStrictReceiveSummary extends BaseOperationSummary {
  type: 'pathPaymentStrictReceive';
  sendAsset: AssetSummary;
  sendMax: string;
  destination: string;
  destAsset: AssetSummary;
  destAmount: string;
  path: AssetSummary[];
}

export interface PathPaymentStrictSendSummary extends BaseOperationSummary {
  type: 'pathPaymentStrictSend';
  sendAsset: AssetSummary;
  sendAmount: string;
  destination: string;
  destAsset: AssetSummary;
  destMin: string;
  path: AssetSummary[];
}

export interface ManageSellOfferSummary extends BaseOperationSummary {
  type: 'manageSellOffer';
  selling: AssetSummary;
  buying: AssetSummary;
  amount: string;
  price: string;
  offerId: string;
}

export interface ManageBuyOfferSummary extends BaseOperationSummary {
  type: 'manageBuyOffer';
  selling: AssetSummary;
  buying: AssetSummary;
  buyAmount: string;
  price: string;
  offerId: string;
}

export interface CreatePassiveSellOfferSummary extends BaseOperationSummary {
  type: 'createPassiveSellOffer';
  selling: AssetSummary;
  buying: AssetSummary;
  amount: string;
  price: string;
}

export interface SetOptionsSummary extends BaseOperationSummary {
  type: 'setOptions';
  changes: string[];
  homeDomain?: string;
  inflationDest?: string;
  masterWeight?: number;
  lowThreshold?: number;
  medThreshold?: number;
  highThreshold?: number;
  setFlags?: number;
  clearFlags?: number;
}

export interface ChangeTrustSummary extends BaseOperationSummary {
  type: 'changeTrust';
  asset?: AssetSummary;
  liquidityPoolId?: string;
  limit: string;
  isRemoval: boolean;
}

export interface AllowTrustSummary extends BaseOperationSummary {
  type: 'allowTrust';
  trustor: string;
  assetCode: string;
  authorize: number | boolean;
}

export interface AccountMergeSummary extends BaseOperationSummary {
  type: 'accountMerge';
  destination: string;
}

export interface InflationSummary extends BaseOperationSummary {
  type: 'inflation';
}

export interface ManageDataSummary extends BaseOperationSummary {
  type: 'manageData';
  name: string;
  value: string | null;
}

export interface BumpSequenceSummary extends BaseOperationSummary {
  type: 'bumpSequence';
  bumpTo: string;
}

export interface CreateClaimableBalanceSummary extends BaseOperationSummary {
  type: 'createClaimableBalance';
  asset: AssetSummary;
  amount: string;
  claimantCount: number;
}

export interface ClaimClaimableBalanceSummary extends BaseOperationSummary {
  type: 'claimClaimableBalance';
  balanceId: string;
}

export interface BeginSponsoringFutureReservesSummary extends BaseOperationSummary {
  type: 'beginSponsoringFutureReserves';
  sponsoredId: string;
}

export interface EndSponsoringFutureReservesSummary extends BaseOperationSummary {
  type: 'endSponsoringFutureReserves';
}

export interface RevokeSponsorshipSummary extends BaseOperationSummary {
  type: 'revokeSponsorship';
  subtype: string;
}

export interface ClawbackSummary extends BaseOperationSummary {
  type: 'clawback';
  from: string;
  asset: AssetSummary;
  amount: string;
}

export interface ClawbackClaimableBalanceSummary extends BaseOperationSummary {
  type: 'clawbackClaimableBalance';
  balanceId: string;
}

export interface SetTrustLineFlagsSummary extends BaseOperationSummary {
  type: 'setTrustLineFlags';
  trustor: string;
  asset: AssetSummary;
  flags: Record<string, boolean | undefined>;
}

export interface LiquidityPoolDepositSummary extends BaseOperationSummary {
  type: 'liquidityPoolDeposit';
  liquidityPoolId: string;
  maxAmountA: string;
  maxAmountB: string;
  minPrice: string;
  maxPrice: string;
}

export interface LiquidityPoolWithdrawSummary extends BaseOperationSummary {
  type: 'liquidityPoolWithdraw';
  liquidityPoolId: string;
  amount: string;
  minAmountA: string;
  minAmountB: string;
}

export interface InvokeHostFunctionSummary extends BaseOperationSummary {
  type: 'invokeHostFunction';
  hostFunctionType:
    | 'invokeContract'
    | 'createContract'
    | 'uploadContractWasm'
    | 'unknown';
  contractId?: string;
  functionName?: string;
  argCount?: number;
}

export interface UnknownOperationSummary extends BaseOperationSummary {
  type: 'unknown';
  operationType: string;
}

export type OperationSummary =
  | CreateAccountSummary
  | PaymentSummary
  | PathPaymentStrictReceiveSummary
  | PathPaymentStrictSendSummary
  | ManageSellOfferSummary
  | ManageBuyOfferSummary
  | CreatePassiveSellOfferSummary
  | SetOptionsSummary
  | ChangeTrustSummary
  | AllowTrustSummary
  | AccountMergeSummary
  | InflationSummary
  | ManageDataSummary
  | BumpSequenceSummary
  | CreateClaimableBalanceSummary
  | ClaimClaimableBalanceSummary
  | BeginSponsoringFutureReservesSummary
  | EndSponsoringFutureReservesSummary
  | RevokeSponsorshipSummary
  | ClawbackSummary
  | ClawbackClaimableBalanceSummary
  | SetTrustLineFlagsSummary
  | LiquidityPoolDepositSummary
  | LiquidityPoolWithdrawSummary
  | InvokeHostFunctionSummary
  | UnknownOperationSummary;

export interface TransactionSummary {
  envelopeType: 'tx' | 'tx_fee_bump';
  source: string;
  fee: string;
  sequence: string;
  memo?: {
    type: string;
    value: string | null;
  };
  feeBump?: {
    feeSource: string;
    fee: string;
  };
  operations: OperationSummary[];
}

export function truncateAddress(address: string, head = 4, tail = 4): string {
  if (!address || address.length <= head + tail + 3) {
    return address;
  }
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function formatAmount(amount: string | number): string {
  const str = String(amount).trim();
  if (!str.includes('.')) {
    return str;
  }
  const trimmed = str.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

function toAssetSummary(asset: unknown): AssetSummary {
  if (!asset) {
    return { code: 'XLM', isNative: true };
  }
  if (asset instanceof Asset) {
    return asset.isNative()
      ? { code: 'XLM', isNative: true }
      : { code: asset.getCode(), issuer: asset.getIssuer(), isNative: false };
  }
  const record = asset as {
    code?: string;
    issuer?: string;
    isNative?: () => boolean;
  };
  if (typeof record.isNative === 'function' && record.isNative()) {
    return { code: 'XLM', isNative: true };
  }
  if (!record.code || record.code === 'native' || (!record.issuer && record.code === 'XLM')) {
    return { code: 'XLM', isNative: true };
  }
  return {
    code: record.code,
    issuer: record.issuer,
    isNative: false,
  };
}

function formatPrice(price: unknown): string {
  if (typeof price === 'string' || typeof price === 'number') {
    return formatAmount(price);
  }
  if (price && typeof price === 'object' && 'n' in price && 'd' in price) {
    const { n, d } = price as { n: number; d: number };
    if (d === 0) return `${n}/${d}`;
    return formatAmount((n / d).toFixed(7));
  }
  return String(price ?? '0');
}

function formatDataValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString('utf8');
  }
  return String(value);
}

function summarizeInvokeHostFunction(
  op: Record<string, unknown>,
  source?: string,
): InvokeHostFunctionSummary {
  const func = op.func as xdr.HostFunction | undefined;
  const switchName = func?.switch?.()?.name;

  if (switchName === 'hostFunctionTypeInvokeContract') {
    const invokeArgs = func!.invokeContract();
    let contractId = '';
    try {
      contractId = Address.fromScAddress(invokeArgs.contractAddress()).toString();
    } catch {
      contractId = 'unknown-contract';
    }
    const functionName = invokeArgs.functionName().toString();
    const argCount = invokeArgs.args().length;
    return {
      type: 'invokeHostFunction',
      hostFunctionType: 'invokeContract',
      contractId,
      functionName,
      argCount,
      source,
      summary: `Invoke ${functionName}() on ${truncateAddress(contractId)}`,
    };
  }

  if (
    switchName === 'hostFunctionTypeCreateContract' ||
    switchName === 'hostFunctionTypeCreateContractV2'
  ) {
    return {
      type: 'invokeHostFunction',
      hostFunctionType: 'createContract',
      source,
      summary: 'Deploy Soroban contract',
    };
  }

  if (switchName === 'hostFunctionTypeUploadContractWasm') {
    return {
      type: 'invokeHostFunction',
      hostFunctionType: 'uploadContractWasm',
      source,
      summary: 'Upload Soroban contract WASM',
    };
  }

  return {
    type: 'invokeHostFunction',
    hostFunctionType: 'unknown',
    source,
    summary: 'Invoke Soroban host function',
  };
}

function unknownSummary(operationType: string, source?: string): UnknownOperationSummary {
  return {
    type: 'unknown',
    operationType,
    source,
    summary: `Unsupported operation (${operationType})`,
  };
}

/**
 * Summarize a decoded Stellar SDK Operation object, raw `xdr.Operation`,
 * or plain operation record into a typed `OperationSummary`.
 * Never throws on unknown or unsupported operation types.
 */
export function summarizeOperation(
  input: Operation | xdr.Operation | Record<string, unknown>,
): OperationSummary {
  let op: Record<string, unknown>;
  let fallbackType = 'unknown';

  try {
    if (input instanceof xdr.Operation) {
      fallbackType = input.body().switch().name;
      op = Operation.fromXDRObject(input) as unknown as Record<string, unknown>;
    } else if (input && typeof input === 'object') {
      op = input as Record<string, unknown>;
      if (typeof op.type === 'string') {
        fallbackType = op.type;
      }
    } else {
      return unknownSummary('unknown');
    }
  } catch {
    return unknownSummary(fallbackType);
  }

  const type = typeof op.type === 'string' ? op.type : fallbackType;
  const source = typeof op.source === 'string' ? op.source : undefined;

  try {
    switch (type) {
      case 'createAccount': {
        const destination = String(op.destination ?? '');
        const startingBalance = formatAmount(String(op.startingBalance ?? '0'));
        return {
          type: 'createAccount',
          destination,
          startingBalance,
          source,
          summary: `Create account ${truncateAddress(destination)} with ${startingBalance} XLM`,
        };
      }

      case 'payment': {
        const destination = String(op.destination ?? '');
        const asset = toAssetSummary(op.asset);
        const amount = formatAmount(String(op.amount ?? '0'));
        return {
          type: 'payment',
          destination,
          asset,
          amount,
          source,
          summary: `Pay ${amount} ${asset.code} to ${truncateAddress(destination)}`,
        };
      }

      case 'pathPaymentStrictReceive': {
        const sendAsset = toAssetSummary(op.sendAsset);
        const destAsset = toAssetSummary(op.destAsset);
        const sendMax = formatAmount(String(op.sendMax ?? '0'));
        const destAmount = formatAmount(String(op.destAmount ?? '0'));
        const destination = String(op.destination ?? '');
        const path = Array.isArray(op.path) ? op.path.map(toAssetSummary) : [];
        return {
          type: 'pathPaymentStrictReceive',
          sendAsset,
          sendMax,
          destination,
          destAsset,
          destAmount,
          path,
          source,
          summary: `Pay ${destAmount} ${destAsset.code} (max ${sendMax} ${sendAsset.code}) to ${truncateAddress(destination)}`,
        };
      }

      case 'pathPaymentStrictSend': {
        const sendAsset = toAssetSummary(op.sendAsset);
        const destAsset = toAssetSummary(op.destAsset);
        const sendAmount = formatAmount(String(op.sendAmount ?? '0'));
        const destMin = formatAmount(String(op.destMin ?? '0'));
        const destination = String(op.destination ?? '');
        const path = Array.isArray(op.path) ? op.path.map(toAssetSummary) : [];
        return {
          type: 'pathPaymentStrictSend',
          sendAsset,
          sendAmount,
          destination,
          destAsset,
          destMin,
          path,
          source,
          summary: `Send ${sendAmount} ${sendAsset.code} (min ${destMin} ${destAsset.code}) to ${truncateAddress(destination)}`,
        };
      }

      case 'manageSellOffer': {
        const selling = toAssetSummary(op.selling);
        const buying = toAssetSummary(op.buying);
        const amount = formatAmount(String(op.amount ?? '0'));
        const price = formatPrice(op.price);
        const offerId = String(op.offerId ?? '0');
        const summary =
          amount === '0' && offerId !== '0'
            ? `Cancel sell offer #${offerId}`
            : `Sell ${amount} ${selling.code} for ${buying.code} at ${price}`;
        return {
          type: 'manageSellOffer',
          selling,
          buying,
          amount,
          price,
          offerId,
          source,
          summary,
        };
      }

      case 'manageBuyOffer': {
        const selling = toAssetSummary(op.selling);
        const buying = toAssetSummary(op.buying);
        const buyAmount = formatAmount(String(op.buyAmount ?? '0'));
        const price = formatPrice(op.price);
        const offerId = String(op.offerId ?? '0');
        const summary =
          buyAmount === '0' && offerId !== '0'
            ? `Cancel buy offer #${offerId}`
            : `Buy ${buyAmount} ${buying.code} with ${selling.code} at ${price}`;
        return {
          type: 'manageBuyOffer',
          selling,
          buying,
          buyAmount,
          price,
          offerId,
          source,
          summary,
        };
      }

      case 'createPassiveSellOffer': {
        const selling = toAssetSummary(op.selling);
        const buying = toAssetSummary(op.buying);
        const amount = formatAmount(String(op.amount ?? '0'));
        const price = formatPrice(op.price);
        return {
          type: 'createPassiveSellOffer',
          selling,
          buying,
          amount,
          price,
          source,
          summary: `Passive sell ${amount} ${selling.code} for ${buying.code} at ${price}`,
        };
      }

      case 'setOptions': {
        const changes: string[] = [];
        if (op.homeDomain !== undefined) changes.push(`homeDomain=${String(op.homeDomain)}`);
        if (op.inflationDest !== undefined) {
          changes.push(`inflationDest=${truncateAddress(String(op.inflationDest))}`);
        }
        if (op.masterWeight !== undefined) changes.push(`masterWeight=${String(op.masterWeight)}`);
        if (op.lowThreshold !== undefined) changes.push(`lowThreshold=${String(op.lowThreshold)}`);
        if (op.medThreshold !== undefined) changes.push(`medThreshold=${String(op.medThreshold)}`);
        if (op.highThreshold !== undefined) {
          changes.push(`highThreshold=${String(op.highThreshold)}`);
        }
        if (op.setFlags !== undefined) changes.push(`setFlags=${String(op.setFlags)}`);
        if (op.clearFlags !== undefined) changes.push(`clearFlags=${String(op.clearFlags)}`);
        if (op.signer !== undefined) changes.push('signer');

        return {
          type: 'setOptions',
          changes,
          homeDomain: op.homeDomain as string | undefined,
          inflationDest: op.inflationDest as string | undefined,
          masterWeight: op.masterWeight as number | undefined,
          lowThreshold: op.lowThreshold as number | undefined,
          medThreshold: op.medThreshold as number | undefined,
          highThreshold: op.highThreshold as number | undefined,
          setFlags: op.setFlags as number | undefined,
          clearFlags: op.clearFlags as number | undefined,
          source,
          summary:
            changes.length > 0
              ? `Set account options (${changes.join(', ')})`
              : 'Set account options',
        };
      }

      case 'changeTrust': {
        const limit = formatAmount(String(op.limit ?? '0'));
        const isRemoval = limit === '0';
        const line = op.line as Record<string, unknown> | undefined;
        const isPool = line && 'assetA' in line && 'assetB' in line;
        if (isPool) {
          const assetA = toAssetSummary(line.assetA);
          const assetB = toAssetSummary(line.assetB);
          return {
            type: 'changeTrust',
            liquidityPoolId: `${assetA.code}/${assetB.code}`,
            limit,
            isRemoval,
            source,
            summary: isRemoval
              ? `Remove trustline for ${assetA.code}/${assetB.code} pool`
              : `Trust ${assetA.code}/${assetB.code} pool`,
          };
        }
        const asset = toAssetSummary(op.line);
        return {
          type: 'changeTrust',
          asset,
          limit,
          isRemoval,
          source,
          summary: isRemoval
            ? `Remove trustline for ${asset.code}`
            : `Trust ${asset.code} (limit ${limit})`,
        };
      }

      case 'allowTrust': {
        const trustor = String(op.trustor ?? '');
        const assetCode = String(op.assetCode ?? '');
        const authorize = op.authorize as number | boolean;
        const action = authorize ? 'Authorize' : 'Revoke';
        return {
          type: 'allowTrust',
          trustor,
          assetCode,
          authorize,
          source,
          summary: `${action} trustline for ${assetCode} on ${truncateAddress(trustor)}`,
        };
      }

      case 'accountMerge': {
        const destination = String(op.destination ?? '');
        return {
          type: 'accountMerge',
          destination,
          source,
          summary: `Merge account into ${truncateAddress(destination)}`,
        };
      }

      case 'inflation': {
        return {
          type: 'inflation',
          source,
          summary: 'Run inflation',
        };
      }

      case 'manageData': {
        const name = String(op.name ?? '');
        const value = formatDataValue(op.value);
        return {
          type: 'manageData',
          name,
          value,
          source,
          summary:
            value === null
              ? `Delete data entry "${name}"`
              : `Set data entry "${name}"`,
        };
      }

      case 'bumpSequence': {
        const bumpTo = String(op.bumpTo ?? '0');
        return {
          type: 'bumpSequence',
          bumpTo,
          source,
          summary: `Bump sequence to ${bumpTo}`,
        };
      }

      case 'createClaimableBalance': {
        const asset = toAssetSummary(op.asset);
        const amount = formatAmount(String(op.amount ?? '0'));
        const claimantCount = Array.isArray(op.claimants) ? op.claimants.length : 0;
        return {
          type: 'createClaimableBalance',
          asset,
          amount,
          claimantCount,
          source,
          summary: `Create claimable balance of ${amount} ${asset.code} (${claimantCount} claimant${claimantCount === 1 ? '' : 's'})`,
        };
      }

      case 'claimClaimableBalance': {
        const balanceId = String(op.balanceId ?? '');
        return {
          type: 'claimClaimableBalance',
          balanceId,
          source,
          summary: `Claim balance ${truncateAddress(balanceId, 8, 6)}`,
        };
      }

      case 'beginSponsoringFutureReserves': {
        const sponsoredId = String(op.sponsoredId ?? '');
        return {
          type: 'beginSponsoringFutureReserves',
          sponsoredId,
          source,
          summary: `Begin sponsoring reserves for ${truncateAddress(sponsoredId)}`,
        };
      }

      case 'endSponsoringFutureReserves': {
        return {
          type: 'endSponsoringFutureReserves',
          source,
          summary: 'End sponsoring future reserves',
        };
      }

      case 'revokeAccountSponsorship':
      case 'revokeTrustlineSponsorship':
      case 'revokeOfferSponsorship':
      case 'revokeDataSponsorship':
      case 'revokeClaimableBalanceSponsorship':
      case 'revokeLiquidityPoolSponsorship':
      case 'revokeSignerSponsorship': {
        const label = type
          .replace(/^revoke/, '')
          .replace(/Sponsorship$/, '')
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .toLowerCase();
        return {
          type: 'revokeSponsorship',
          subtype: type,
          source,
          summary: `Revoke ${label} sponsorship`,
        };
      }

      case 'clawback': {
        const from = String(op.from ?? '');
        const asset = toAssetSummary(op.asset);
        const amount = formatAmount(String(op.amount ?? '0'));
        return {
          type: 'clawback',
          from,
          asset,
          amount,
          source,
          summary: `Clawback ${amount} ${asset.code} from ${truncateAddress(from)}`,
        };
      }

      case 'clawbackClaimableBalance': {
        const balanceId = String(op.balanceId ?? '');
        return {
          type: 'clawbackClaimableBalance',
          balanceId,
          source,
          summary: `Clawback claimable balance ${truncateAddress(balanceId, 8, 6)}`,
        };
      }

      case 'setTrustLineFlags': {
        const trustor = String(op.trustor ?? '');
        const asset = toAssetSummary(op.asset);
        const flags = (op.flags ?? {}) as Record<string, boolean | undefined>;
        const activeFlags = Object.entries(flags)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`);
        return {
          type: 'setTrustLineFlags',
          trustor,
          asset,
          flags,
          source,
          summary:
            activeFlags.length > 0
              ? `Set ${asset.code} trustline flags (${activeFlags.join(', ')}) on ${truncateAddress(trustor)}`
              : `Set ${asset.code} trustline flags on ${truncateAddress(trustor)}`,
        };
      }

      case 'liquidityPoolDeposit': {
        const liquidityPoolId = String(op.liquidityPoolId ?? '');
        const maxAmountA = formatAmount(String(op.maxAmountA ?? '0'));
        const maxAmountB = formatAmount(String(op.maxAmountB ?? '0'));
        const minPrice = formatPrice(op.minPrice);
        const maxPrice = formatPrice(op.maxPrice);
        return {
          type: 'liquidityPoolDeposit',
          liquidityPoolId,
          maxAmountA,
          maxAmountB,
          minPrice,
          maxPrice,
          source,
          summary: `Deposit up to ${maxAmountA} / ${maxAmountB} into pool ${truncateAddress(liquidityPoolId, 8, 6)}`,
        };
      }

      case 'liquidityPoolWithdraw': {
        const liquidityPoolId = String(op.liquidityPoolId ?? '');
        const amount = formatAmount(String(op.amount ?? '0'));
        const minAmountA = formatAmount(String(op.minAmountA ?? '0'));
        const minAmountB = formatAmount(String(op.minAmountB ?? '0'));
        return {
          type: 'liquidityPoolWithdraw',
          liquidityPoolId,
          amount,
          minAmountA,
          minAmountB,
          source,
          summary: `Withdraw ${amount} shares from pool ${truncateAddress(liquidityPoolId, 8, 6)}`,
        };
      }

      case 'invokeHostFunction': {
        return summarizeInvokeHostFunction(op, source);
      }

      default:
        return unknownSummary(type, source);
    }
  } catch {
    return unknownSummary(type, source);
  }
}

/**
 * Decode a single base64-encoded `xdr.Operation` into a typed `OperationSummary`.
 * Never throws on unknown or malformed operations.
 */
export function summarizeOperationXdr(xdrBase64: string): OperationSummary {
  try {
    const opXdr = xdr.Operation.fromXDR(xdrBase64, 'base64');
    return summarizeOperation(opXdr);
  } catch {
    return unknownSummary('malformed');
  }
}

function summarizeMemo(tx: Transaction): TransactionSummary['memo'] {
  if (!tx.memo || tx.memo.type === 'none') {
    return undefined;
  }
  const rawValue = tx.memo.value;
  let value: string | null = null;
  if (typeof rawValue === 'string') {
    value = rawValue;
  } else if (rawValue instanceof Uint8Array || Buffer.isBuffer(rawValue)) {
    value = Buffer.from(rawValue).toString(
      tx.memo.type === 'text' ? 'utf8' : 'hex',
    );
  } else if (rawValue !== null && rawValue !== undefined) {
    value = String(rawValue);
  }
  return {
    type: tx.memo.type,
    value,
  };
}

/**
 * Decode a base64-encoded Stellar TransactionEnvelope XDR (standard or fee-bump)
 * into a typed `TransactionSummary` with human-readable operation summaries.
 */
export function summarizeTransactionXdr(
  xdrBase64: string,
  networkPassphrase: string = Networks.TESTNET,
): TransactionSummary {
  const parsed = TransactionBuilder.fromXDR(xdrBase64, networkPassphrase);

  if (parsed instanceof FeeBumpTransaction) {
    const inner = parsed.innerTransaction;
    return {
      envelopeType: 'tx_fee_bump',
      source: inner.source,
      fee: inner.fee,
      sequence: inner.sequence,
      memo: summarizeMemo(inner),
      feeBump: {
        feeSource: parsed.feeSource,
        fee: parsed.fee,
      },
      operations: inner.operations.map((op) =>
        summarizeOperation(op as unknown as Record<string, unknown>),
      ),
    };
  }

  return {
    envelopeType: 'tx',
    source: parsed.source,
    fee: parsed.fee,
    sequence: parsed.sequence,
    memo: summarizeMemo(parsed),
    operations: parsed.operations.map((op) =>
      summarizeOperation(op as unknown as Record<string, unknown>),
    ),
  };
}

export { StrKey };
