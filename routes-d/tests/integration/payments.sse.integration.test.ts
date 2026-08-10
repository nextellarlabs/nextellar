/**
 * Integration tests for payment status SSE streaming.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import paymentsSseRouter, {
  __resetPaymentsSse,
  __seedPayment,
  __transitionPaymentStatus,
  __getPayment,
} from '../../routes/payments.sse.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsSseRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Payment status SSE integration', () => {
  const app = buildApp();
  const userId = 'integration-user';
  const paymentId = 'integration-pay';

  beforeEach(() => {
    __resetPaymentsSse();
    __seedPayment({
      id: paymentId,
      userId,
      status: 'pending',
      amount: 250,
      currency: 'XLM',
      createdAt: '2026-07-10T08:00:00.000Z',
      updatedAt: '2026-07-10T08:00:00.000Z',
    });
  });

  it('connects, receives live transitions, and persists payment status', async () => {
    let resolveBody: (body: string) => void;
    const bodyPromise = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });

    const streamReq = request(app)
      .get(`/payments/${paymentId}/status/stream`)
      .set('x-user-id', userId)
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.includes('"status":"failed"')) {
            response.destroy();
            resolveBody(body);
            callback(null, body);
          }
        });
        response.on('error', (err: Error) => {
          if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
            resolveBody(body);
            callback(null, body);
            return;
          }
          callback(err, body);
        });
      })
      .end();

    await new Promise((r) => setTimeout(r, 40));
    __transitionPaymentStatus(paymentId, 'processing');
    __transitionPaymentStatus(paymentId, 'failed');

    const body = await bodyPromise;
    await streamReq;

    expect(body).toContain('"status":"pending"');
    expect(body).toContain('"status":"processing"');
    expect(body).toContain('"status":"failed"');
    expect(__getPayment(paymentId)?.status).toBe('failed');
  });

  it('replays missed events after reconnect with Last-Event-ID', async () => {
    __transitionPaymentStatus(paymentId, 'processing');

    const res = await request(app)
      .get(`/payments/${paymentId}/status/stream`)
      .set('x-user-id', userId)
      .set('Last-Event-ID', '1')
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        const timer = setTimeout(() => {
          response.destroy();
          callback(null, body);
        }, 200);
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        response.on('error', () => {
          clearTimeout(timer);
          callback(null, body);
        });
      });

    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('"status":"processing"');
    expect(String(res.body)).not.toContain('"status":"pending"');
  });
});
