export type ScValKind =
  | 'scvBool'
  | 'scvVoid'
  | 'scvU32'
  | 'scvI32'
  | 'scvU64'
  | 'scvI64'
  | 'scvBytes'
  | 'scvString'
  | 'scvSymbol'
  | 'scvAddress'
  | 'scvVec'
  | 'scvMap';

export type ScValMapEntry = { key: ScValShape; val: ScValShape };

export interface ScValShape {
  type: ScValKind | string;
  value?: unknown;
}

export type DecodedScVal =
  | boolean
  | null
  | number
  | string
  | DecodedScVal[]
  | Record<string, DecodedScVal>
  | { _unknown: string; raw: unknown };

export function decodeScVal(scv: ScValShape): DecodedScVal {
  switch (scv.type) {
    case 'scvBool':
      return Boolean(scv.value);

    case 'scvVoid':
      return null;

    case 'scvU32':
    case 'scvI32':
      return Number(scv.value);

    case 'scvU64':
    case 'scvI64':
      return String(scv.value);

    case 'scvBytes':
      if (Buffer.isBuffer(scv.value)) return scv.value.toString('hex');
      if (scv.value instanceof Uint8Array)
        return Buffer.from(scv.value).toString('hex');
      return String(scv.value);

    case 'scvString':
      if (Buffer.isBuffer(scv.value)) return scv.value.toString('utf-8');
      if (scv.value instanceof Uint8Array)
        return Buffer.from(scv.value).toString('utf-8');
      return String(scv.value);

    case 'scvSymbol':
    case 'scvAddress':
      return String(scv.value);

    case 'scvVec': {
      const items = scv.value;
      if (!Array.isArray(items)) return [];
      return items.map((item) => decodeScVal(item as ScValShape));
    }

    case 'scvMap': {
      const entries = scv.value;
      if (!Array.isArray(entries)) return {};
      const result: Record<string, DecodedScVal> = {};
      for (const entry of entries as ScValMapEntry[]) {
        const k = String(decodeScVal(entry.key));
        result[k] = decodeScVal(entry.val);
      }
      return result;
    }

    default:
      return { _unknown: scv.type, raw: scv.value ?? null };
  }
}
