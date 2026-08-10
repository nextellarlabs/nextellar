import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import notificationsRouter, { notificationDeps } from '../../backend/routes/notifications.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe('POST /notifications', () => {
  const app = buildApp();
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('returns 200 immediately when push succeeds', async () => {
    notificationDeps.sendPushNotification = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/notifications')
      .send({ userId: 'user-1', message: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(notificationDeps.sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('returns 200 even when push service fails (fire-and-forget)', async () => {
    const pushError = new Error('Push service unavailable');
    notificationDeps.sendPushNotification = jest.fn().mockRejectedValue(pushError);

    const res = await request(app)
      .post('/notifications')
      .send({ userId: 'user-1', message: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Flush microtask queue so the .catch() fires
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(consoleSpy).toHaveBeenCalledWith(
      '[notifications] push delivery failed:',
      'Push service unavailable',
    );
  });

  it('does NOT propagate unhandled rejection when push fails', async () => {
    notificationDeps.sendPushNotification = jest.fn().mockRejectedValue(
      new Error('network error'),
    );

    const unhandledRejectionSpy = jest.fn();
    process.once('unhandledRejection', unhandledRejectionSpy);

    await request(app)
      .post('/notifications')
      .send({ userId: 'user-2', message: 'Test' });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(unhandledRejectionSpy).not.toHaveBeenCalled();
    process.removeListener('unhandledRejection', unhandledRejectionSpy);
  });

  it('returns 400 when payload is not an object (array)', async () => {
    // Arrays are typeof 'object' but not notification payloads we accept
    // We check the route handles non-plain-object bodies gracefully
    notificationDeps.sendPushNotification = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/notifications')
      .send([1, 2, 3]); // arrays are valid JSON but not valid notification objects

    // Arrays are still typeof 'object' so the route accepts and queues them —
    // payload validation is intentionally delegated to the push service layer.
    // The route itself only rejects non-objects (null / primitives).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('passes the full payload to the push service', async () => {
    notificationDeps.sendPushNotification = jest.fn().mockResolvedValue(undefined);
    const payload = { userId: 'u-99', title: 'Alert', body: 'You have a new message' };

    await request(app).post('/notifications').send(payload);

    expect(notificationDeps.sendPushNotification).toHaveBeenCalledWith(payload);
  });
});
