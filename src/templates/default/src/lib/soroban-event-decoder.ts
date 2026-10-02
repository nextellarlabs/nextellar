import { Address, xdr } from '@stellar/stellar-sdk';

export type SorobanValue = string | number | bigint | boolean | null | Uint8Array | SorobanValue[] | Record<string, SorobanValue>;

/** Decode one topic or event value returned by Soroban RPC (base64 XDR). */
export function decodeSorobanValue<T extends SorobanValue = SorobanValue>(encoded: string): T {
  return decodeScVal(xdr.ScVal.fromXDR(encoded, 'base64')) as T;
}

/** Decode all event topics and the event data into ordinary typed values. */
export function decodeSorobanEvent<T extends SorobanValue = SorobanValue>(event: {
  topic: string[];
  value: string;
}): { topics: T[]; value: T } {
  return {
    topics: event.topic.map((topic) => decodeSorobanValue<T>(topic)),
    value: decodeSorobanValue<T>(event.value),
  };
}

function decodeScVal(value: xdr.ScVal): SorobanValue {
  switch (value.switch().name) {
    case 'scvVoid': return null;
    case 'scvBool': return value.b();
    case 'scvU32': return value.u32();
    case 'scvI32': return value.i32();
    case 'scvU64': case 'scvI64': return BigInt(value.u64().toString());
    case 'scvU128': case 'scvI128': case 'scvU256': case 'scvI256': return BigInt(value.toString().replace(/[^0-9-]/g, ''));
    case 'scvString': return value.str().toString();
    case 'scvSymbol': return value.sym().toString();
    case 'scvBytes': return new Uint8Array(value.bytes());
    case 'scvAddress': return Address.fromScVal(value).toString();
    case 'scvVec': return (value.vec() ?? []).map(decodeScVal);
    case 'scvMap': return Object.fromEntries((value.map() ?? []).map((entry) => [String(decodeScVal(entry.key)), decodeScVal(entry.val)]));
    case 'scvTimepoint': case 'scvDuration': return BigInt(value.u64().toString());
    case 'scvLedgerKeyContractInstance': return 'contract-instance';
    default: throw new Error(`Unsupported Soroban value type: ${value.switch().name}`);
  }
}
