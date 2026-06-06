// Tests for routes-d/middleware/idempotency.ts (Issue #286).
//
// Covers the cases not present in middleware.suite.test.ts:
//   - Expired key is treated as a fresh first request
//   - Concurrent duplicate submissions return 409 Conflict
//   - Idempotency middleware is applied to payments.send and payments.refund

import request from 'supertest';
import express from 'express';
import { idempotency, IdempotencyStore } from '../middleware/idempotency.js';
import { createPaymentSendRouter } from '../routes/payments.send.js';
import { createRefundRouter } from '../routes/payments.refund.js';
import type { PaymentRecord, RefundRecord } from '../routes/payments.refund.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(store: IdempotencyStore) {
  const app = express();
  app.use(express.json());
  app.post('/ok', idempotency({ store }), (_req, res) =>
    res.status(201).json({ created: true }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// Expired key
// ---------------------------------------------------------------------------

describe('IdempotencyStore — expired key', () => {
  it('returns undefined for a key older than ttlMs', () => {
    let now = 0;
    const store = new IdempotencyStore(1000, () => now);
    store.setInFlight('key-a');
    store.store('key-a', 201, { created: true });

    // Advance past TTL
    now = 1001;
    expect(store.get('key-a')).toBeUndefined();
  });

  it('treats the expired key as a new request', async () => {
    let now = 0;
    const store = new IdempotencyStore(1000, () => now);
    const app = buildApp(store);

    // First request — stores response
    await request(app).post('/ok').set('Idempotency-Key', 'exp-key').send({});

    // Advance past TTL
    now = 2000;

    // Second request with same key should run the handler again (201, not replay)
    const res = await request(app)
      .post('/ok')
      .set('Idempotency-Key', 'exp-key')
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: true });
  });
});

// ---------------------------------------------------------------------------
// Concurrent submissions
// ---------------------------------------------------------------------------

describe('idempotency middleware — concurrent submissions', () => {
  it('returns 409 when a second request arrives while the first is in-flight', async () => {
    const store = new IdempotencyStore();

    // Manually mark a key as in-flight to simulate an ongoing request
    store.setInFlight('concurrent-key');

    const app = buildApp(store);
    const res = await request(app)
      .post('/ok')
      .set('Idempotency-Key', 'concurrent-key')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('request_in_flight');
  });

  it('clears the in-flight lock when the response closes before json() is called', async () => {
    const store = new IdempotencyStore();
    const app = express();
    app.use(express.json());

    // Handler that never calls res.json — simulates an aborted handler
    app.post('/abort', idempotency({ store }), (_req, res) => {
      // Emit 'close' manually to trigger cleanup logic
      res.emit('close');
    });

    // Fire the aborted request to set inFlight
    await request(app).post('/abort').set('Idempotency-Key', 'abort-key').send({}).timeout(200).catch(() => {});

    // Key should have been removed; a follow-up should NOT get 409
    expect(store.get('abort-key')).toBeUndefined();
  });

  it('allows a retry after in-flight lock is released', async () => {
    const store = new IdempotencyStore();
    const app = buildApp(store);

    // Simulate: first call completes and stores a response
    await request(app).post('/ok').set('Idempotency-Key', 'retry-key').send({});

    // Second call with the same key replays the stored response (not 409)
    const replay = await request(app)
      .post('/ok')
      .set('Idempotency-Key', 'retry-key')
      .send({});
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ created: true });
  });
});

// ---------------------------------------------------------------------------
// Payments.send uses idempotency middleware
// ---------------------------------------------------------------------------

describe('payments.send — idempotency integration', () => {
  const DEST = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678';

  function buildPaymentApp(store: IdempotencyStore) {
    const app = express();
    app.use(express.json());
    app.use(
      '/payments',
      createPaymentSendRouter({ idempotencyOptions: { store } }),
    );
    return app;
  }

  it('replays the stored response on a duplicate send request', async () => {
    const store = new IdempotencyStore();
    const app = buildPaymentApp(store);

    const payload = { destination: DEST, amount: '10', assetCode: 'XLM' };
    const first = await request(app)
      .post('/payments/send')
      .set('Idempotency-Key', 'send-key-001')
      .send(payload);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/payments/send')
      .set('Idempotency-Key', 'send-key-001')
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('returns 409 for a concurrent duplicate send', async () => {
    const store = new IdempotencyStore();
    store.setInFlight('send-key-002');
    const app = buildPaymentApp(store);

    const res = await request(app)
      .post('/payments/send')
      .set('Idempotency-Key', 'send-key-002')
      .send({ destination: DEST, amount: '5', assetCode: 'XLM' });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Payments.refund uses idempotency middleware
// ---------------------------------------------------------------------------

describe('payments.refund — idempotency integration', () => {
  function buildRefundApp(store: IdempotencyStore) {
    const payments = new Map<string, PaymentRecord>([
      ['p1', { id: 'p1', payerId: 'alice', amount: 500, currency: 'XLM', status: 'captured' }],
    ]);
    const refunds: RefundRecord[] = [];

    const app = express();
    app.use(express.json());
    app.use(
      '/payments',
      createRefundRouter({
        payments: {
          async get(id) { return payments.get(id); },
          async markRefunded(id) {
            const p = payments.get(id);
            if (p) payments.set(id, { ...p, status: 'refunded' });
          },
        },
        refunds: {
          async findByIdempotency(paymentId, key) {
            return refunds.find((r) => r.paymentId === paymentId && r.idempotencyKey === key);
          },
          async save(r) { refunds.push(r); },
        },
        dispatcher: { async refund() { return { refundId: 'rf_test' }; } },
        idempotencyOptions: { store },
      }),
    );
    return app;
  }

  it('returns 409 for a concurrent duplicate refund', async () => {
    const store = new IdempotencyStore();
    store.setInFlight('refund-key-001');
    const app = buildRefundApp(store);

    const res = await request(app)
      .post('/payments/p1/refund')
      .set('Idempotency-Key', 'refund-key-001')
      .send({ requesterId: 'alice', requesterRole: 'user' });
    expect(res.status).toBe(409);
  });
});
