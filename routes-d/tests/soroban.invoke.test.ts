// Integration tests for `routes-d/routes/soroban.invoke.ts`. The Soroban
// RPC is stubbed with an in-memory fake — every test path stays offline
// and deterministic.

import express, { type Express } from 'express';
import request from 'supertest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { createSorobanInvokeRouter } from '../routes/soroban.invoke.js';
import type { SorobanRpcLike } from '../lib/sorobanClient.js';

interface FakeRpcOptions {
  simulateError?: string;
  sendStatus?: 'PENDING' | 'ERROR' | 'DUPLICATE';
  finalStatus?: 'SUCCESS' | 'FAILED';
  resultXdr?: string;
  noHash?: boolean;
}

function makeRpc(opts: FakeRpcOptions = {}): SorobanRpcLike {
  return {
    async getAccount(publicKey: string) {
      let seq = 0;
      return {
        accountId: () => publicKey,
        sequenceNumber: () => String(seq),
        incrementSequenceNumber: () => {
          seq += 1;
        },
      };
    },
    async simulateTransaction() {
      if (opts.simulateError) {
        return { error: opts.simulateError };
      }
      return {
        result: { retval: { toXDR: () => 'AAAA' } },
      };
    },
    async sendTransaction() {
      if (opts.noHash) {
        return { status: 'PENDING' };
      }
      return {
        status: opts.sendStatus ?? 'PENDING',
        hash: 'cafe',
        errorResult:
          opts.sendStatus === 'ERROR'
            ? { toXDR: () => 'AAEC' }
            : undefined,
      };
    },
    async getTransaction() {
      const status = opts.finalStatus ?? 'SUCCESS';
      if (status === 'SUCCESS') {
        return {
          status: 'SUCCESS',
          returnValue: { toXDR: () => opts.resultXdr ?? 'AAAA' },
        };
      }
      return {
        status: 'FAILED',
        resultXdr: { toXDR: () => 'AAEC' },
      };
    },
  } as unknown as SorobanRpcLike;
}

function buildApp(rpc: SorobanRpcLike): { app: Express; signer: Keypair } {
  const signer = Keypair.random();
  const app = express();
  app.use(express.json());
  app.use(
    '/soroban',
    createSorobanInvokeRouter({
      rpc,
      networkPassphrase: Networks.TESTNET,
      resolveSigner: () => signer.secret(),
    }),
  );
  return { app, signer };
}

const VALID_CONTRACT = 'CA' + 'A'.repeat(54);

describe('POST /soroban/invoke', () => {
  it('returns the simulated result when the chain reports SUCCESS', async () => {
    const { app } = buildApp(makeRpc({ resultXdr: 'AAAAEg==' }));

    const res = await request(app).post('/soroban/invoke').send({
      contractId: VALID_CONTRACT,
      method: 'transfer',
      args: [],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      contractId: VALID_CONTRACT,
      method: 'transfer',
      resultXdr: 'AAAAEg==',
    });
  });

  it('returns 409 with REVERT when the chain reports FAILED', async () => {
    const { app } = buildApp(makeRpc({ finalStatus: 'FAILED' }));

    const res = await request(app).post('/soroban/invoke').send({
      contractId: VALID_CONTRACT,
      method: 'burn',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, code: 'REVERT' });
  });

  it('returns 400 with SIMULATION_FAILED when the simulation rejects', async () => {
    const { app } = buildApp(makeRpc({ simulateError: 'host function trapped' }));

    const res = await request(app).post('/soroban/invoke').send({
      contractId: VALID_CONTRACT,
      method: 'mint',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      code: 'SIMULATION_FAILED',
      message: 'host function trapped',
    });
  });

  it('returns 502 with SUBMIT_FAILED when sendTransaction reports ERROR', async () => {
    const { app } = buildApp(makeRpc({ sendStatus: 'ERROR' }));

    const res = await request(app).post('/soroban/invoke').send({
      contractId: VALID_CONTRACT,
      method: 'transfer',
    });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, code: 'SUBMIT_FAILED' });
  });

  it('rejects requests missing the contractId with 400', async () => {
    const { app } = buildApp(makeRpc());

    const res = await request(app).post('/soroban/invoke').send({
      method: 'transfer',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'contractId is required' });
  });

  it('rejects requests missing the method with 400', async () => {
    const { app } = buildApp(makeRpc());

    const res = await request(app).post('/soroban/invoke').send({
      contractId: VALID_CONTRACT,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'method is required' });
  });

  it('rejects requests with non-array args', async () => {
    const { app } = buildApp(makeRpc());

    const res = await request(app)
      .post('/soroban/invoke')
      .send({ contractId: VALID_CONTRACT, method: 'm', args: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'args must be an array' });
  });
});
