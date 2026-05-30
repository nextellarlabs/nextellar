import express from 'express';
import request from 'supertest';
import sorobanStorageRouter, {
  sorobanStorageDeps,
  __clearSorobanStorageCache,
} from '../routes/soroban.storage.js';
import { decodeScVal } from '../lib/sorobanStorageDecoder.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(sorobanStorageRouter);
  return app;
}

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

beforeEach(() => {
  __clearSorobanStorageCache();
  sorobanStorageDeps.fetchStorage = jest.fn().mockResolvedValue(null);
});

describe('GET /soroban/storage/:contractId', () => {
  const app = buildApp();

  it('returns 400 when key query param is missing', async () => {
    const res = await request(app).get(`/soroban/storage/${CONTRACT_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/key/i);
  });

  it('returns 404 when the storage entry does not exist', async () => {
    const res = await request(app)
      .get(`/soroban/storage/${CONTRACT_ID}`)
      .query({ key: 'balance' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns decoded value for an existing entry', async () => {
    (sorobanStorageDeps.fetchStorage as jest.Mock).mockResolvedValue({
      type: 'scvU64',
      value: BigInt('9007199254740992'),
    });

    const res = await request(app)
      .get(`/soroban/storage/${CONTRACT_ID}`)
      .query({ key: 'balance' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cached).toBe(false);
    expect(res.body.data).toBe('9007199254740992');
  });

  it('returns cached response within the TTL window', async () => {
    (sorobanStorageDeps.fetchStorage as jest.Mock).mockResolvedValue({
      type: 'scvBool',
      value: true,
    });

    await request(app)
      .get(`/soroban/storage/${CONTRACT_ID}`)
      .query({ key: 'flag' });

    const res = await request(app)
      .get(`/soroban/storage/${CONTRACT_ID}`)
      .query({ key: 'flag' });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(sorobanStorageDeps.fetchStorage).toHaveBeenCalledTimes(1);
  });
});

describe('decodeScVal', () => {
  it('decodes scvBool true', () => {
    expect(decodeScVal({ type: 'scvBool', value: true })).toBe(true);
  });

  it('decodes scvBool false', () => {
    expect(decodeScVal({ type: 'scvBool', value: false })).toBe(false);
  });

  it('decodes scvVoid as null', () => {
    expect(decodeScVal({ type: 'scvVoid' })).toBeNull();
  });

  it('decodes scvU32', () => {
    expect(decodeScVal({ type: 'scvU32', value: 42 })).toBe(42);
  });

  it('decodes scvI32 negative value', () => {
    expect(decodeScVal({ type: 'scvI32', value: -7 })).toBe(-7);
  });

  it('decodes scvU64 as string to preserve precision', () => {
    const big = '18446744073709551615';
    expect(decodeScVal({ type: 'scvU64', value: BigInt(big) })).toBe(big);
  });

  it('decodes scvI64 as string', () => {
    expect(decodeScVal({ type: 'scvI64', value: BigInt(-1) })).toBe('-1');
  });

  it('decodes scvBytes as hex string', () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    expect(decodeScVal({ type: 'scvBytes', value: buf })).toBe('deadbeef');
  });

  it('decodes scvString as utf-8', () => {
    const buf = Buffer.from('hello', 'utf-8');
    expect(decodeScVal({ type: 'scvString', value: buf })).toBe('hello');
  });

  it('decodes scvSymbol as string', () => {
    expect(decodeScVal({ type: 'scvSymbol', value: 'TOKEN' })).toBe('TOKEN');
  });

  it('decodes scvAddress as string', () => {
    expect(
      decodeScVal({ type: 'scvAddress', value: 'GABC...XYZ' }),
    ).toBe('GABC...XYZ');
  });

  it('decodes scvVec recursively', () => {
    const scv = {
      type: 'scvVec' as const,
      value: [
        { type: 'scvU32', value: 1 },
        { type: 'scvU32', value: 2 },
      ],
    };
    expect(decodeScVal(scv)).toEqual([1, 2]);
  });

  it('decodes scvMap into a JS object', () => {
    const scv = {
      type: 'scvMap' as const,
      value: [
        {
          key: { type: 'scvSymbol', value: 'name' },
          val: { type: 'scvString', value: 'nextellar' },
        },
        {
          key: { type: 'scvSymbol', value: 'version' },
          val: { type: 'scvU32', value: 1 },
        },
      ],
    };
    expect(decodeScVal(scv)).toEqual({ name: 'nextellar', version: 1 });
  });

  it('returns a _unknown wrapper for unrecognised ScVal kinds', () => {
    const result = decodeScVal({ type: 'scvFuture', value: 99 }) as {
      _unknown: string;
    };
    expect(result._unknown).toBe('scvFuture');
  });
});
