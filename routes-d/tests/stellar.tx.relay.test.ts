// Tests for stellar.tx.prepare and stellar.tx.submit routes (Issue #273).
//
// Covers:
//   - prepare: valid request, allowlist rejection, missing fields
//   - submit:  valid request, allowlist rejection, missing fields, network error
//   - operationAllowlist: checkOperations unit tests

import express, { type Express } from 'express';
import request from 'supertest';
import {
  createPrepareRouter,
  type PrepareTransactionDeps,
} from '../routes/stellar.tx.prepare.js';
import {
  createSubmitRouter,
  type SubmitTransactionDeps,
} from '../routes/stellar.tx.submit.js';
import {
  checkOperations,
  createAllowlist,
  DEFAULT_ALLOWED_OPERATIONS,
} from '../lib/operationAllowlist.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrepareApp(deps?: Partial<PrepareTransactionDeps>): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/stellar/tx',
    createPrepareRouter({
      deps: {
        buildEnvelope: ({ sourceAccount, operations }) =>
          Buffer.from(JSON.stringify({ sourceAccount, operations })).toString('base64'),
        network: 'Test SDF Network ; September 2015',
        ...deps,
      },
    }),
  );
  return app;
}

function buildSubmitApp(deps?: Partial<SubmitTransactionDeps>): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/stellar/tx',
    createSubmitRouter({
      deps: {
        submitEnvelope: async (envelope) => ({
          hash: `hash-${envelope.slice(0, 8)}`,
          submittedAt: '2026-01-01T00:00:00.000Z',
        }),
        ...deps,
      },
    }),
  );
  return app;
}

const VALID_PREPARE_BODY = {
  sourceAccount: 'GABC1234',
  operations: [{ type: 'payment', destination: 'GXYZ', amount: '10' }],
};

const VALID_SUBMIT_BODY = {
  envelope: 'AAAA==',
  operations: [{ type: 'payment' }],
};

// ---------------------------------------------------------------------------
// operationAllowlist unit tests
// ---------------------------------------------------------------------------

describe('checkOperations', () => {
  it('returns allowed=true when all ops are in the allowlist', () => {
    const result = checkOperations(['payment', 'manageData'], DEFAULT_ALLOWED_OPERATIONS);
    expect(result.allowed).toBe(true);
    expect(result.disallowed).toEqual([]);
  });

  it('returns allowed=false and lists disallowed types', () => {
    const result = checkOperations(
      ['payment', 'accountMerge', 'setOptions'],
      DEFAULT_ALLOWED_OPERATIONS,
    );
    expect(result.allowed).toBe(false);
    expect(result.disallowed).toContain('accountMerge');
    expect(result.disallowed).toContain('setOptions');
  });

  it('returns allowed=false for an empty allowlist', () => {
    const result = checkOperations(['payment'], new Set());
    expect(result.allowed).toBe(false);
  });
});

describe('createAllowlist', () => {
  it('merges extra types with defaults', () => {
    const list = createAllowlist(['customOp']);
    expect(list.has('payment')).toBe(true);
    expect(list.has('customOp')).toBe(true);
  });

  it('replaces defaults when replaceDefaults=true', () => {
    const list = createAllowlist(['customOp'], true);
    expect(list.has('payment')).toBe(false);
    expect(list.has('customOp')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /stellar/tx/prepare
// ---------------------------------------------------------------------------

describe('POST /stellar/tx/prepare', () => {
  it('returns 200 with an envelope for a valid request', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send(VALID_PREPARE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.envelope).toBe('string');
    expect(res.body.data.network).toBe('Test SDF Network ; September 2015');
    expect(res.body.data.sourceAccount).toBe('GABC1234');
    expect(res.body.data.operations).toHaveLength(1);
  });

  it('returns 403 when an operation type is disallowed', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send({
        sourceAccount: 'GABC1234',
        operations: [{ type: 'accountMerge' }],
      });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.disallowed).toContain('accountMerge');
  });

  it('returns 403 for mixed allowed/disallowed operations', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send({
        sourceAccount: 'GABC1234',
        operations: [{ type: 'payment' }, { type: 'setOptions' }],
      });

    expect(res.status).toBe(403);
    expect(res.body.disallowed).toEqual(['setOptions']);
  });

  it('returns 400 when sourceAccount is missing', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send({ operations: [{ type: 'payment' }] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when operations array is empty', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send({ sourceAccount: 'GABC1234', operations: [] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when an operation entry lacks a type field', async () => {
    const res = await request(buildPrepareApp())
      .post('/stellar/tx/prepare')
      .send({ sourceAccount: 'GABC1234', operations: [{ kind: 'payment' }] });

    expect(res.status).toBe(400);
  });

  it('returns 500 when buildEnvelope throws', async () => {
    const res = await request(
      buildPrepareApp({
        buildEnvelope: () => {
          throw new Error('sdk error');
        },
      }),
    )
      .post('/stellar/tx/prepare')
      .send(VALID_PREPARE_BODY);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('uses a custom allowlist when provided', async () => {
    const app = express();
    app.use(express.json());
    app.use(
      '/stellar/tx',
      createPrepareRouter({
        deps: {
          buildEnvelope: () => 'env==',
          network: 'testnet',
          allowedOperations: new Set(['customOp']),
        },
      }),
    );

    const allowed = await request(app)
      .post('/stellar/tx/prepare')
      .send({ sourceAccount: 'G1', operations: [{ type: 'customOp' }] });
    expect(allowed.status).toBe(200);

    const denied = await request(app)
      .post('/stellar/tx/prepare')
      .send({ sourceAccount: 'G1', operations: [{ type: 'payment' }] });
    expect(denied.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /stellar/tx/submit
// ---------------------------------------------------------------------------

describe('POST /stellar/tx/submit', () => {
  it('returns 200 with transaction data on a valid request', async () => {
    const res = await request(buildSubmitApp())
      .post('/stellar/tx/submit')
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.data.hash).toBe('string');
    expect(typeof res.body.data.submittedAt).toBe('string');
  });

  it('returns 403 when an operation type is disallowed', async () => {
    const res = await request(buildSubmitApp())
      .post('/stellar/tx/submit')
      .send({ envelope: 'AAAA==', operations: [{ type: 'accountMerge' }] });

    expect(res.status).toBe(403);
    expect(res.body.disallowed).toContain('accountMerge');
  });

  it('returns 400 when envelope is missing', async () => {
    const res = await request(buildSubmitApp())
      .post('/stellar/tx/submit')
      .send({ operations: [{ type: 'payment' }] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when operations array is empty', async () => {
    const res = await request(buildSubmitApp())
      .post('/stellar/tx/submit')
      .send({ envelope: 'AAAA==', operations: [] });

    expect(res.status).toBe(400);
  });

  it('returns 502 when submitEnvelope throws', async () => {
    const res = await request(
      buildSubmitApp({
        submitEnvelope: async () => {
          throw new Error('horizon error');
        },
      }),
    )
      .post('/stellar/tx/submit')
      .send(VALID_SUBMIT_BODY);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('horizon error');
  });
});
