import { MuxedAccount, StrKey } from '@stellar/stellar-sdk';

export interface DecodedMuxedAccount {
  isMuxed: boolean;
  rawAddress: string;
  baseAddress: string;
  muxedId?: string;
}

/**
 * Validates whether a destination address is a valid standard G... address
 * or a valid SEP-23 M... muxed account address.
 */
export function isValidDestinationAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return (
    StrKey.isValidEd25519PublicKey(address) ||
    StrKey.isValidMed25519PublicKey(address)
  );
}

/**
 * Validates whether an address string is a valid SEP-23 M... muxed account.
 */
export function isMuxedAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return address.startsWith('M') && StrKey.isValidMed25519PublicKey(address);
}

/**
 * Decodes a destination address (G... or M...) to its base account and optional muxed ID.
 * Throws an Error if the address is malformed or has an invalid checksum.
 */
export function decodeDestinationAddress(address: string): DecodedMuxedAccount {
  if (!address || typeof address !== 'string') {
    throw new Error('Destination address must be a non-empty string');
  }

  if (address.startsWith('M')) {
    if (!StrKey.isValidMed25519PublicKey(address)) {
      throw new Error('Invalid muxed account address (SEP-23): malformed or invalid checksum');
    }
    const muxed = MuxedAccount.fromAddress(address, '0');
    return {
      isMuxed: true,
      rawAddress: address,
      baseAddress: muxed.baseAccount().accountId(),
      muxedId: muxed.id(),
    };
  }

  if (StrKey.isValidEd25519PublicKey(address)) {
    return {
      isMuxed: false,
      rawAddress: address,
      baseAddress: address,
    };
  }

  throw new Error(`Invalid Stellar address format: ${address}`);
}
