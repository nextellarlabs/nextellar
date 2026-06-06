export interface Sep31Counterparty {
  first_name?: string;
  last_name?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  postal_code?: string;
}

export interface Sep31TransactionRequest {
  asset_code: string;
  asset_issuer?: string;
  amount: string;
  destination_account: string;
  destination_memo?: string;
  destination_memo_type?: 'text' | 'id' | 'hash';
  customer_id?: string;
  fields: Sep31Counterparty;
}

export interface Sep31ValidationError {
  field: string;
  message: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
import { validatePaymentAmount } from "./amount.js";

export function validateSep31Transaction(
  body: unknown,
): { valid: true; data: Sep31TransactionRequest } | { valid: false; errors: Sep31ValidationError[] } {
  const errors: Sep31ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [{ field: 'body', message: 'Request body is required' }] };
  }

  const req = body as Record<string, unknown>;

  const assetCode = typeof req.asset_code === 'string' ? req.asset_code.trim() : '';
  if (!assetCode || assetCode.length > 12) {
    errors.push({ field: 'asset_code', message: 'asset_code is required (max 12 chars)' });
  }

  const assetIssuer =
    typeof req.asset_issuer === 'string' ? req.asset_issuer.trim() : undefined;
  if (assetCode !== 'XLM' && !assetIssuer) {
    errors.push({ field: 'asset_issuer', message: 'asset_issuer is required for non-native assets' });
  }

  const amountRaw = typeof req.amount === 'string' ? req.amount.trim() : req.amount;
  const amountCheck = validatePaymentAmount({
    amount: amountRaw,
    asset: { code: assetCode || 'XLM', issuer: assetIssuer },
  });
  if (!amountCheck.ok) {
    for (const err of amountCheck.errors) {
      errors.push({ field: err.field === 'asset' ? 'asset_issuer' : 'amount', message: err.message });
    }
  }
  const amount = amountCheck.ok ? amountCheck.amount : '';

  const destinationAccount =
    typeof req.destination_account === 'string' ? req.destination_account.trim() : '';
  if (!destinationAccount || !destinationAccount.startsWith('G')) {
    errors.push({
      field: 'destination_account',
      message: 'destination_account must be a valid Stellar account (G...)',
    });
  }

  const memoType = req.destination_memo_type;
  if (memoType !== undefined && memoType !== 'text' && memoType !== 'id' && memoType !== 'hash') {
    errors.push({
      field: 'destination_memo_type',
      message: 'destination_memo_type must be text, id, or hash',
    });
  }

  const fields = req.fields;
  if (!fields || typeof fields !== 'object') {
    errors.push({ field: 'fields', message: 'counterparty fields object is required' });
  } else {
    const cp = fields as Record<string, unknown>;
    const firstName = typeof cp.first_name === 'string' ? cp.first_name.trim() : '';
    const lastName = typeof cp.last_name === 'string' ? cp.last_name.trim() : '';
    const email = typeof cp.email === 'string' ? cp.email.trim() : '';
    const country = typeof cp.country === 'string' ? cp.country.trim() : '';

    if (!firstName) {
      errors.push({ field: 'fields.first_name', message: 'first_name is required' });
    }
    if (!lastName) {
      errors.push({ field: 'fields.last_name', message: 'last_name is required' });
    }
    if (!email || !EMAIL_PATTERN.test(email)) {
      errors.push({ field: 'fields.email', message: 'valid email is required' });
    }
    if (!country || country.length !== 2) {
      errors.push({ field: 'fields.country', message: 'country must be a 2-letter ISO code' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      asset_code: assetCode,
      asset_issuer: assetIssuer,
      amount,
      destination_account: destinationAccount,
      destination_memo:
        typeof req.destination_memo === 'string' ? req.destination_memo : undefined,
      destination_memo_type: memoType as Sep31TransactionRequest['destination_memo_type'],
      customer_id: typeof req.customer_id === 'string' ? req.customer_id : undefined,
      fields: fields as Sep31Counterparty,
    },
  };
}
