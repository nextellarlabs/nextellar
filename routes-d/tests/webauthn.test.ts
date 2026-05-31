import express from 'express';
import request from 'supertest';
import registerRouter from '../routes/auth.webauthn.register.js';
import loginRouter from '../routes/auth.webauthn.login.js';
import {
  buildAuthenticationClientData,
  buildRegistrationClientData,
  webAuthnStore,
} from '../auth/webauthnService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(registerRouter);
  app.use(loginRouter);
  return app;
}

function buildRegistrationCredential(challenge: string, credentialId = 'cred-1') {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key' as const,
    response: {
      clientDataJSON: buildRegistrationClientData(challenge),
      attestationObject: 'test-attestation-object',
    },
  };
}

function buildAuthenticationCredential(challenge: string, credentialId = 'cred-1') {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key' as const,
    response: {
      clientDataJSON: buildAuthenticationClientData(challenge),
      authenticatorData: 'auth-data',
      signature: 'signature-data',
    },
  };
}

describe('WebAuthn passkey routes', () => {
  const app = buildApp();
  const userId = 'user-123';

  beforeEach(() => {
    webAuthnStore.clear();
  });

  describe('registration', () => {
    it('returns registration options with challenge', async () => {
      const res = await request(app)
        .post('/auth/webauthn/register/options')
        .send({ userId });

      expect(res.status).toBe(200);
      expect(res.body.data.challenge).toBeDefined();
    });

    it('registers a passkey with a name', async () => {
      const options = await request(app)
        .post('/auth/webauthn/register/options')
        .send({ userId });

      const challenge = options.body.data.challenge;

      const res = await request(app)
        .post('/auth/webauthn/register')
        .send({
          userId,
          credentialName: 'MacBook Touch ID',
          challenge,
          credential: buildRegistrationCredential(challenge),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.credentialId).toBe('cred-1');
      expect(res.body.data.name).toBe('MacBook Touch ID');
    });

    it('allows multiple credentials per user', async () => {
      const options1 = await request(app)
        .post('/auth/webauthn/register/options')
        .send({ userId });
      await request(app)
        .post('/auth/webauthn/register')
        .send({
          userId,
          credentialName: 'Phone',
          challenge: options1.body.data.challenge,
          credential: buildRegistrationCredential(options1.body.data.challenge, 'cred-phone'),
        });

      const options2 = await request(app)
        .post('/auth/webauthn/register/options')
        .send({ userId });
      const res = await request(app)
        .post('/auth/webauthn/register')
        .send({
          userId,
          credentialName: 'Laptop',
          challenge: options2.body.data.challenge,
          credential: buildRegistrationCredential(options2.body.data.challenge, 'cred-laptop'),
        });

      expect(res.status).toBe(201);
      expect(webAuthnStore.getUserCredentials(userId)).toHaveLength(2);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      const options = await request(app)
        .post('/auth/webauthn/register/options')
        .send({ userId });
      await request(app)
        .post('/auth/webauthn/register')
        .send({
          userId,
          credentialName: 'Primary',
          challenge: options.body.data.challenge,
          credential: buildRegistrationCredential(options.body.data.challenge),
        });
    });

    it('returns login options for registered user', async () => {
      const res = await request(app)
        .post('/auth/webauthn/login/options')
        .send({ userId });

      expect(res.status).toBe(200);
      expect(res.body.data.challenge).toBeDefined();
      expect(res.body.data.allowCredentials).toHaveLength(1);
    });

    it('authenticates with valid assertion', async () => {
      const options = await request(app)
        .post('/auth/webauthn/login/options')
        .send({ userId });
      const challenge = options.body.data.challenge;

      const res = await request(app)
        .post('/auth/webauthn/login')
        .send({
          userId,
          challenge,
          credential: buildAuthenticationCredential(challenge),
        });

      expect(res.status).toBe(200);
      expect(res.body.data.authenticated).toBe(true);
    });

    it('rejects replayed assertion', async () => {
      const options = await request(app)
        .post('/auth/webauthn/login/options')
        .send({ userId });
      const challenge = options.body.data.challenge;
      const credential = buildAuthenticationCredential(challenge);

      await request(app)
        .post('/auth/webauthn/login')
        .send({ userId, challenge, credential });

      const replayOptions = await request(app)
        .post('/auth/webauthn/login/options')
        .send({ userId });

      const replayChallenge = replayOptions.body.data.challenge;

      const replayRes = await request(app)
        .post('/auth/webauthn/login')
        .send({
          userId,
          challenge: replayChallenge,
          credential: buildAuthenticationCredential(replayChallenge),
        });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error).toMatch(/replay/i);
    });
  });
});
