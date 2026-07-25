import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import paymentsSseRouter, {
  __resetPaymentsSse,
  __seedPayment,
  __transitionPaymentStatus,
  __createSubscriberForTest,
  __enqueueEventForSubscriber,
  __CONNECTION_EVENT_BUFFER_CAPACITY,
} from '../routes/payments.sse.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsSseRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function parseSseEvents(raw: string): Array<{ id: string; event: string; data: Record<string, unknown> }> {
  const events: Array<{ id: string; event: string; data: Record<string, unknown> }> = [];
  const chunks = raw.split('\n\n').filter((block) => block.trim() && !block.startsWith(':'));
  for (const block of chunks) {
    const lines = block.split('\n');
    let id = '';
    let event = '';
    let dataLine = '';
    for (const line of lines) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLine = line.slice(5).trim();
    }
    if (dataLine) {
      events.push({ id, event, data: JSON.parse(dataLine) as Record<string, unknown> });
    }
  }
  return events;
}

const USER = 'user-pay-1';
const PAYMENT_ID = 'pay-sse-1';
const BASE_PAYMENT = {
  id: PAYMENT_ID,
  userId: USER,
  status: 'pending' as const,
  amount: 100,
  currency: 'USDC',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
};

describe('GET /payments/:paymentId/status/stream', () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPaymentsSse();
  });

  it('streams initial payment status on connect', async () => {
    __seedPayment(BASE_PAYMENT);

    const res = await request(app)
      .get(`/payments/${PAYMENT_ID}/status/stream`)
      .set('x-user-id', USER)
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.includes('"status":"pending"')) {
            response.destroy();
            callback(null, body);
          }
        });
        response.on('error', (err: Error) => {
          if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
            callback(null, body);
            return;
          }
          callback(err, body);
        });
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSseEvents(String(res.body));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('status');
    expect(events[0].data.status).toBe('pending');
  });

  it('emits status transitions to an active connection', async () => {
    __seedPayment(BASE_PAYMENT);

    let resolveBody: (body: string) => void;
    const bodyPromise = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });

    const req = request(app)
      .get(`/payments/${PAYMENT_ID}/status/stream`)
      .set('x-user-id', USER)
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.includes('"status":"processing"')) {
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
      });

    const streamReq = req.end();

    await new Promise((r) => setTimeout(r, 50));
    __transitionPaymentStatus(PAYMENT_ID, 'processing');

    const raw = await bodyPromise;
    await streamReq;

    const events = parseSseEvents(raw);
    const statuses = events.map((e) => e.data.status);
    expect(statuses).toContain('processing');
  });

  it('resumes from Last-Event-ID on reconnect', async () => {
    __seedPayment(BASE_PAYMENT);
    __transitionPaymentStatus(PAYMENT_ID, 'processing');
    __transitionPaymentStatus(PAYMENT_ID, 'completed');

    const res = await request(app)
      .get(`/payments/${PAYMENT_ID}/status/stream`)
      .set('x-user-id', USER)
      .set('Last-Event-ID', '1')
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        const timer = setTimeout(() => {
          response.destroy();
          callback(null, body);
        }, 150);
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.includes('"status":"completed"')) {
            clearTimeout(timer);
            response.destroy();
            callback(null, body);
          }
        });
        response.on('error', () => {
          clearTimeout(timer);
          callback(null, body);
        });
      });

    expect(res.status).toBe(200);
    const events = parseSseEvents(String(res.body));
    const statuses = events.map((e) => e.data.status);
    expect(statuses).toContain('processing');
    expect(statuses).toContain('completed');
    for (const event of events) {
      expect(Number.parseInt(event.id, 10)).toBeGreaterThan(1);
    }
  });

  it('bounds per-connection buffer for slow consumers', () => {
    const mockRes = {
      write: () => false,
    } as unknown as Response;

    const subscriber = __createSubscriberForTest(PAYMENT_ID, mockRes);
    const capacity = __CONNECTION_EVENT_BUFFER_CAPACITY;

    for (let i = 0; i < capacity + 10; i += 1) {
      __enqueueEventForSubscriber(subscriber, {
        id: String(i + 1),
        paymentId: PAYMENT_ID,
        status: 'processing',
        previousStatus: 'pending',
        at: new Date().toISOString(),
      });
    }

    expect(subscriber.pending.size).toBe(capacity);
  });

  it('returns 401 without x-user-id', async () => {
    __seedPayment(BASE_PAYMENT);

    const res = await request(app).get(`/payments/${PAYMENT_ID}/status/stream`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown payment', async () => {
    const res = await request(app)
      .get(`/payments/missing/status/stream`)
      .set('x-user-id', USER);

    expect(res.status).toBe(404);
  });
});
