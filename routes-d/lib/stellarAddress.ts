import { StrKey } from '@stellar/stellar-sdk';
import { decodeAddressToMuxedAccount } from '@stellar/stellar-sdk/lib/util/decode_encode_muxed_account';

/**
 * Validate a Stellar address.
 * Supports classic Ed25519 public keys (G...) and muxed accounts (M...).
 * Returns an array of error messages; empty array means the address is valid.
 */
export function validateStellarAddress(address: string): string[] {
  const errors: string[] = [];
  if (typeof address !== 'string' || address.trim() === '') {
    errors.push('Address must be a non‑empty string');
    return errors;
  }
  const trimmed = address.trim();
  // Check classic G address using StrKey
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return errors; // valid
  }
  // Attempt to decode as muxed account (M address)
  try {
    decodeAddressToMuxedAccount(trimmed);
    // If no error, it's a valid muxed address
    return errors;
  } catch (e) {
    errors.push('Invalid Stellar address format');
    return errors;
  }
}
