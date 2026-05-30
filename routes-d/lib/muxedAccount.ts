import {
  StrKey,
  decodeAddressToMuxedAccount,
  encodeMuxedAccount,
  encodeMuxedAccountToAddress,
} from '@stellar/stellar-sdk';

const MAX_MUX_ID = BigInt('18446744073709551615'); // 2^64 - 1

export interface ParsedMuxedAccount {
  baseAccount: string;
  muxId: string;
}

export class MuxedAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MuxedAccountError';
  }
}

/**
 * Validate a muxed subaccount id (uint64, decimal string, no leading zeros except "0").
 */
export function isValidMuxId(muxId: string): boolean {
  if (typeof muxId !== 'string' || muxId.length === 0) {
    return false;
  }

  if (!/^\d+$/.test(muxId)) {
    return false;
  }

  if (muxId.length > 1 && muxId.startsWith('0')) {
    return false;
  }

  try {
    const value = BigInt(muxId);
    return value >= BigInt(0) && value <= MAX_MUX_ID;
  } catch {
    return false;
  }
}

/**
 * Derive a muxed Stellar address (M...) from a base G-address and subaccount id.
 */
export function deriveMuxedAddress(baseAccount: string, muxId: string): string {
  if (!StrKey.isValidEd25519PublicKey(baseAccount)) {
    throw new MuxedAccountError('Invalid base Stellar account address');
  }

  if (!isValidMuxId(muxId)) {
    throw new MuxedAccountError('Invalid muxed subaccount id');
  }

  const muxed = encodeMuxedAccount(baseAccount, muxId);
  return encodeMuxedAccountToAddress(muxed);
}

/**
 * Parse a muxed address (M...) into its base account and subaccount id.
 */
export function parseMuxedAddress(muxedAddress: string): ParsedMuxedAccount {
  if (!StrKey.isValidMed25519PublicKey(muxedAddress)) {
    throw new MuxedAccountError('Invalid muxed account address');
  }

  const decoded = decodeAddressToMuxedAccount(muxedAddress);
  if (decoded.switch().name !== 'keyTypeMuxedEd25519') {
    throw new MuxedAccountError('Address is not a muxed account');
  }

  const med25519 = decoded.med25519();
  const baseAccount = StrKey.encodeEd25519PublicKey(med25519.ed25519());
  const muxId = med25519.id().toString();

  return { baseAccount, muxId };
}

/**
 * Match an inbound payment destination against an expected muxed subaccount.
 * Accepts either a muxed (M...) or base (G...) address on the payment side.
 */
export function matchesInboundPayment(
  paymentDestination: string,
  expectedBaseAccount: string,
  expectedMuxId: string,
): boolean {
  if (!isValidMuxId(expectedMuxId)) {
    return false;
  }

  if (!StrKey.isValidEd25519PublicKey(expectedBaseAccount)) {
    return false;
  }

  const expectedMuxed = deriveMuxedAddress(expectedBaseAccount, expectedMuxId);

  if (StrKey.isValidMed25519PublicKey(paymentDestination)) {
    return paymentDestination === expectedMuxed;
  }

  if (StrKey.isValidEd25519PublicKey(paymentDestination)) {
    return paymentDestination === expectedBaseAccount && expectedMuxId === '0';
  }

  return false;
}
