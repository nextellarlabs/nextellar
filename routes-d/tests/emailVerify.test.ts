import express from 'express';
import request from 'supertest';
import emailVerifyRouter from '../routes/auth.email.verify.js';
import { emailDispatcherDeps } from '../lib/emailDispatcher.js';
import { verificationTokenStore } from '../lib/verificationTokenStore.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(emailVerifyRouter);
  return app;
}

describe('Email verification routes', () => {
  const app = buildApp();
  let sendEmailMock: jest.Mock;
  let lastToken: string | undefined;

  beforeEach(() => {
    verificationTokenStore.clear();
    lastToken = undefined;
    sendEmailMock = jest.fn().mockImplementation(async (payload) => {
      lastToken = payload.token;
    });
    emailDispatcherDeps.sendVerificationEmail = sendEmailMock;
  });

  describe('POST /auth/email/verify/request', () => {
    it('sends verification token via email dispatcher', async () => {
      const res = await request(app)
        .post('/auth/email/verify/request')
        .send({ email: 'user@example.com', userId: 'user-1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      expect(lastToken).toBeDefined();
    });

    it('rejects invalid email', async () => {
      const res = await request(app)
        .post('/auth/email/verify/request')
        .send({ email: 'not-an-email', userId: 'user-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/email/verify/confirm', () => {
    it('confirms a valid token', async () => {
      await request(app)
        .post('/auth/email/verify/request')
        .send({ email: 'user@example.com', userId: 'user-1' });

      const res = await request(app)
        .post('/auth/email/verify/confirm')
        .send({ token: lastToken });

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.email).toBe('user@example.com');
    });

    it('rejects expired token', async () => {
      const record = verificationTokenStore.createToken('user@example.com', 'user-1');
      record.expiresAt = Date.now() - 1000;

      const res = await request(app)
        .post('/auth/email/verify/confirm')
        .send({ token: record.token });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('rejects reused token', async () => {
      await request(app)
        .post('/auth/email/verify/request')
        .send({ email: 'user@example.com', userId: 'user-1' });

      await request(app)
        .post('/auth/email/verify/confirm')
        .send({ token: lastToken });

      const res = await request(app)
        .post('/auth/email/verify/confirm')
        .send({ token: lastToken });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already used/i);
    });
  });
});
