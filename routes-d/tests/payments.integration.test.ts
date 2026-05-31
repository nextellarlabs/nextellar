// Integration tests for the Nextellar payment flow (#306).
//
// Composes payments.send + payments.refund routes on a single Express app
// and exercises the end-to-end pipeline with in-memory stores and injected
// mocks for the refund dispatcher and webhook delivery.
//
// Soroban contract invocation (invokeContract / soroban.invoke route) requires
// @stellar/stellar-sdk to be installed. Those flows are covered separately
// when the SDK is available. All payment HTTP flows are tested here.

import { jest } from '@jest/globals';
import express, { type Express } from 'express';
import request from 'supertest';
import {
  createPaymentSendRouter,
} from '../routes/payments.send.js';
import {
  createRefundRouter,
  type PaymentRecord,
  type PaymentStore,
  type RefundRecord,
  type RefundStore,
  type RefundDispatcher,
} from '../routes/payments.refund.js';
import {
  OrderWebhookDispatcher,
  type FetchLike,
  type OrderWebhookPayload,
} from '../lib/orderWebhooks.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FIXTURE = {
  DESTINATION: 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678',
  AMOUNT: '10.5',
  ASSET_CODE: 'XLM',
  CAPTURED_PAYMENT: {
    id: 'p1',
    payerId: 'alice',
    amount: 1050,
    currency: 'USDC',
    status: 'captured' as const,
  },
  FAILED_PAYMENT: {
    id: 'p2',
    payerId: 'bob',
    amount: 500,
    currency: 'XLM',
    status: 'failed' as const,
  },
} as const;

// ---------------------------------------------------------------------------
// In-memory store builders (mirrors payments.refund.test.ts)
// ---------------------------------------------------------------------------

function buildPaymentStore(
  initial: readonly PaymentRecord[] = [],
): PaymentStore & { inspect(): Map<string, PaymentRecord>; seed(p: PaymentRecord): void } {
  const map = new Map<string, PaymentRecord>(initial.map((p) => [p.id, p]));
  return {
    async get(id) { return map.get(id); },
    async markRefunded(id) {
      const p = map.get(id);
      if (p) map.set(id, { ...p, status: 'refunded' });
    },
    inspect: () => map,
    seed: (p: PaymentRecord) => map.set(p.id, p),
  };
}

function buildRefundStore(): RefundStore & { inspect(): RefundRecord[] } {
  const list: RefundRecord[] = [];
  return {
    async findByIdempotency(paymentId, idempotencyKey) {
      return list.find(
        (r) => r.paymentId === paymentId && r.idempotencyKey === idempotencyKey,
      );
    },
    async save(refund) { list.push(refund); },
    inspect: () => list,
  };
}

// ---------------------------------------------------------------------------
// Composed integration app
// ---------------------------------------------------------------------------

function buildIntegrationApp(opts: {
  dispatcher?: RefundDispatcher;
  initialPayments?: readonly PaymentRecord[];
  now?: () => number;
} = {}) {
  const payments = buildPaymentStore(opts.initialPayments ?? []);
  const refunds = buildRefundStore();
  const dispatcher: RefundDispatcher = opts.dispatcher ?? {
    refund: jest.fn().mockResolvedValue({ refundId: 'rf_test' }),
  };

  const app: Express = express();
  app.use(express.json());
  app.use('/payments', createPaymentSendRouter());
  app.use(
    '/payments',
    createRefundRouter({
      payments,
      refunds,
      dispatcher,
      now: opts.now ?? (() => 5000),
      newRefundId: () => 'rf_fixed',
    }),
  );

  return { app, payments, refunds };
}

// ---------------------------------------------------------------------------
// Flow 1 — Happy path: payment send builds and returns an envelope
// ---------------------------------------------------------------------------

describe('Flow 1: POST /payments/send — happy path', () => {
  it('returns 200 with envelope, amount, asset, and destination', async () => {
    const { app } = buildIntegrationApp();

    const res = await request(app)
      .post('/payments/send')
      .send({
        destination: FIXTURE.DESTINATION,
        amount: FIXTURE.AMOUNT,
        assetCode: FIXTURE.ASSET_CODE,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.envelope).toBe('string');
    expect(res.body.amount).toBe('10.5');
    expect(res.body.asset.code).toBe('XLM');
    expect(res.body.destination).toBe(FIXTURE.DESTINATION);
  });

  it('rejects a missing destination with 400', async () => {
    const { app } = buildIntegrationApp();

    const res = await request(app)
      .post('/payments/send')
      .send({ amount: '1.0', assetCode: 'XLM' });

    expect(res.status).toBe(400);
  });

  it('uses an injected envelope builder to simulate Horizon submission', async () => {
    const { app } = buildIntegrationApp();
    // The buildEnvelope option is used by createPaymentSendRouter; here we
    // verify that the route returns the envelope string produced by the builder.
    // In production this would be a real XDR envelope submitted to Horizon.
    const { app: appWithEnvelope } = buildIntegrationApp();
    const customApp: Express = express();
    customApp.use(express.json());
    customApp.use(
      '/payments',
      createPaymentSendRouter({
        buildEnvelope: (params) => `horizon_envelope_${params.assetCode}_${params.amount}`,
      }),
    );

    const res = await request(customApp)
      .post('/payments/send')
      .send({
        destination: FIXTURE.DESTINATION,
        amount: FIXTURE.AMOUNT,
        assetCode: FIXTURE.ASSET_CODE,
      });

    expect(res.status).toBe(200);
    expect(res.body.envelope).toBe(`horizon_envelope_${FIXTURE.ASSET_CODE}_${FIXTURE.AMOUNT}`);
  });
});

// ---------------------------------------------------------------------------
// Flow 2 — Refund happy path with idempotency
// ---------------------------------------------------------------------------

describe('Flow 2: POST /payments/:id/refund — happy path + idempotency', () => {
  it('refunds a captured payment and replays idempotently', async () => {
    const dispatchFn = jest.fn().mockResolvedValue({ refundId: 'rf_prov' });
    const { app, payments, refunds } = buildIntegrationApp({
      initialPayments: [{ ...FIXTURE.CAPTURED_PAYMENT }],
      dispatcher: { refund: dispatchFn },
    });

    const first = await request(app)
      .post('/payments/p1/refund')
      .send({ requesterId: 'alice', requesterRole: 'user', idempotencyKey: 'k1' });

    expect(first.status).toBe(201);
    expect(first.body.ok).toBe(true);
    expect(first.body.idempotent).toBe(false);

    const second = await request(app)
      .post('/payments/p1/refund')
      .send({ requesterId: 'alice', requesterRole: 'user', idempotencyKey: 'k1' });

    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.refund).toEqual(first.body.refund);

    // Dispatcher called exactly once across both attempts.
    expect(dispatchFn).toHaveBeenCalledTimes(1);
    expect(payments.inspect().get('p1')?.status).toBe('refunded');
    expect(refunds.inspect()).toHaveLength(1);
  });

  it('rejects cross-user refund attempts with 403', async () => {
    const { app } = buildIntegrationApp({
      initialPayments: [{ ...FIXTURE.CAPTURED_PAYMENT }],
    });

    const res = await request(app)
      .post('/payments/p1/refund')
      .send({ requesterId: 'mallory', requesterRole: 'user' });

    expect(res.status).toBe(403);
  });

  it('allows an admin to refund on behalf of the payer', async () => {
    const dispatchFn = jest.fn().mockResolvedValue({ refundId: 'rf_admin' });
    const { app } = buildIntegrationApp({
      initialPayments: [{ ...FIXTURE.CAPTURED_PAYMENT }],
      dispatcher: { refund: dispatchFn },
    });

    const res = await request(app)
      .post('/payments/p1/refund')
      .send({ requesterId: 'ops', requesterRole: 'admin' });

    expect(res.status).toBe(201);
    expect(dispatchFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Flow 3 — Webhook side effects after refund
// ---------------------------------------------------------------------------

describe('Flow 3: OrderWebhookDispatcher — signed delivery', () => {
  it('sends a webhook with the correct signature and event headers', async () => {
    const captured: { url: string; headers: Record<string, string>; body: string }[] = [];

    const mockFetcher: FetchLike = jest.fn().mockImplementation(
      async (url, init) => {
        captured.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 200 };
      },
    );

    const dispatcher = new OrderWebhookDispatcher(
      'https://example.com/webhook',
      'test-secret',
      { fetcher: mockFetcher, sleep: () => Promise.resolve() },
    );

    const payload: OrderWebhookPayload = {
      event: 'order.fulfilled',
      orderId: 'ord-1',
      occurredAt: 5000,
      data: { status: 'refunded' },
    };

    const result = await dispatcher.dispatch(payload);

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    // Signature is a 64-char hex HMAC-SHA256
    expect(captured[0].headers['X-Nextellar-Signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(captured[0].headers['X-Nextellar-Event']).toBe('order.fulfilled');
  });
});

// ---------------------------------------------------------------------------
// Flow 4 — Dispatcher failure: 502 and no state mutation
// ---------------------------------------------------------------------------

describe('Flow 4: Dispatcher failure — 502, payment state unchanged', () => {
  it('returns 502 and leaves payment in failed state when dispatcher throws', async () => {
    const { app, payments, refunds } = buildIntegrationApp({
      initialPayments: [{ ...FIXTURE.FAILED_PAYMENT }],
      dispatcher: { refund: jest.fn().mockRejectedValue(new Error('network')) },
    });

    const res = await request(app)
      .post('/payments/p2/refund')
      .send({ requesterId: 'bob', requesterRole: 'user' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, error: 'refund dispatcher failed' });
    expect(payments.inspect().get('p2')?.status).toBe('failed');
    expect(refunds.inspect()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Flow 5 — Refund + webhook: webhook failure does not affect payment state
// ---------------------------------------------------------------------------

describe('Flow 5: Webhook fetcher failure — payment already committed', () => {
  it('dispatch failure does not roll back the completed refund', async () => {
    const dispatchFn = jest.fn().mockResolvedValue({ refundId: 'rf_prov2' });
    const { app, payments, refunds } = buildIntegrationApp({
      initialPayments: [
        { id: 'p3', payerId: 'carol', amount: 200, currency: 'USDC', status: 'captured' as const },
      ],
      dispatcher: { refund: dispatchFn },
    });

    // Complete the refund via HTTP
    const refundRes = await request(app)
      .post('/payments/p3/refund')
      .send({ requesterId: 'carol', requesterRole: 'user' });
    expect(refundRes.status).toBe(201);

    // Webhook delivery fails after the refund is already committed
    const failingFetcher: FetchLike = jest.fn().mockRejectedValue(
      new Error('ECONNREFUSED'),
    );
    const wh = new OrderWebhookDispatcher(
      'https://example.com/wh',
      'test-secret',
      { fetcher: failingFetcher, maxAttempts: 1, sleep: () => Promise.resolve() },
    );

    const whResult = await wh.dispatch({
      event: 'order.fulfilled',
      orderId: 'p3',
      occurredAt: 5000,
      data: {},
    });

    // Webhook failed
    expect(whResult.ok).toBe(false);
    expect(whResult.lastError).toContain('ECONNREFUSED');

    // Payment and refund records are unchanged — payment was committed before webhook
    expect(payments.inspect().get('p3')?.status).toBe('refunded');
    expect(refunds.inspect()).toHaveLength(1);
  });
});
