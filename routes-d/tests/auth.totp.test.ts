import express from 'express';
import request from 'supertest';
import {
  TotpSecretStore,
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  formatOtpAuthUrl,
  generateTotp,
  verifyTotp,
} from '../lib/totp.js';
import { createTotpRouter } from '../routes/auth.totp.js';

function buildApp(store: TotpSecretStore) {
  const app = express();
  app.use(express.json());
  app.use(createTotpRouter({ store, issuer: 'Nextellar' }));
  return app;
}

describe('base32 round-trip', () => {
  it('encodes and decodes back to the original bytes', () => {
    const buf = Buffer.from('test-vector-bytes', 'utf8');
    const encoded = base32Encode(buf);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(encoded)).toEqual(buf);
  });

  it('rejects invalid characters', () => {
    expect(() => base32Decode('NOT_BASE32!')).toThrow();
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips arbitrary bytes', () => {
    const plain = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const encrypted = encryptSecret(plain);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    expect(decryptSecret(encrypted)).toEqual(plain);
  });

  it('produces a different ciphertext on every call (random IV)', () => {
    const plain = Buffer.from('same input');
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rejects tampered ciphertexts', () => {
    const encrypted = encryptSecret(Buffer.from('secret'));
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from(
        Buffer.from(encrypted.ciphertext, 'base64')
          .map((b, i) => (i === 0 ? b ^ 0x01 : b)),
      ).toString('base64'),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('generateTotp / verifyTotp', () => {
  it('generates a 6-digit code that verifies at the same instant', () => {
    const secret = Buffer.from('12345678901234567890', 'utf8');
    const code = generateTotp(secret, 59_000);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { timestampMs: 59_000 })).toEqual({
      ok: true,
      counter: Math.floor(59 / 30),
    });
  });

  it('accepts a code generated one step in the past (drift)', () => {
    const secret = Buffer.from('drift-test-secret');
    const codeAtPrev = generateTotp(secret, 0);
    const result = verifyTotp(secret, codeAtPrev, { timestampMs: 30_000 });
    expect(result.ok).toBe(true);
    expect(result.counter).toBe(0);
  });

  it('rejects codes outside the drift window', () => {
    const secret = Buffer.from('drift-test-secret');
    const codeAtPrev = generateTotp(secret, 0);
    // 5 steps later — outside default ±1 drift.
    const result = verifyTotp(secret, codeAtPrev, {
      timestampMs: 150_000,
      driftSteps: 1,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed input', () => {
    const secret = Buffer.from('secret');
    expect(verifyTotp(secret, 'abcdef').ok).toBe(false);
    expect(verifyTotp(secret, '12345').ok).toBe(false);
  });
});

describe('formatOtpAuthUrl', () => {
  it('encodes label and required query params', () => {
    const url = formatOtpAuthUrl({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      accountName: 'user@example.com',
      issuer: 'Nextellar',
    });
    expect(url).toMatch(/^otpauth:\/\/totp\/Nextellar%3Auser%40example\.com\?/);
    expect(url).toMatch(/secret=JBSWY3DPEHPK3PXP/);
    expect(url).toMatch(/issuer=Nextellar/);
    expect(url).toMatch(/algorithm=SHA1/);
    expect(url).toMatch(/digits=6/);
    expect(url).toMatch(/period=30/);
  });
});

describe('TotpSecretStore', () => {
  it('starts an enrolment as pending and activates on first verify', () => {
    const store = new TotpSecretStore();
    const { record, secretBase32 } = store.startEnrollment('user-1');
    expect(record.state).toBe('pending');
    expect(secretBase32).toMatch(/^[A-Z2-7]+$/);
    expect(store.isActive('user-1')).toBe(false);

    const secret = decryptSecret(record.encrypted);
    const code = generateTotp(secret);
    expect(store.verifyAndConsume('user-1', code)).toEqual({ ok: true });
    expect(store.isActive('user-1')).toBe(true);
  });

  it('rejects an unknown user', () => {
    const store = new TotpSecretStore();
    expect(store.verifyAndConsume('ghost', '123456')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects a wrong code', () => {
    const store = new TotpSecretStore();
    store.startEnrollment('user-1');
    expect(store.verifyAndConsume('user-1', '000000')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects replay of the same OTP', () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);
    const code = generateTotp(secret);

    expect(store.verifyAndConsume('user-1', code)).toEqual({ ok: true });
    // Same code presented again inside the same step → must be rejected
    // as a replay, not silently accepted.
    expect(store.verifyAndConsume('user-1', code)).toEqual({
      ok: false,
      reason: 'replay',
    });
  });

  it('disable() forgets the record so a fresh enrolment can begin', () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);
    store.verifyAndConsume('user-1', generateTotp(secret));
    expect(store.isActive('user-1')).toBe(true);

    expect(store.disable('user-1')).toBe(true);
    expect(store.isActive('user-1')).toBe(false);
    expect(store.disable('user-1')).toBe(false);
  });
});

describe('POST /auth/totp/enroll', () => {
  it('returns 401 when no user can be resolved', async () => {
    const store = new TotpSecretStore();
    const app = buildApp(store);
    const res = await request(app).post('/auth/totp/enroll').send({});
    expect(res.status).toBe(401);
  });

  it('returns a base32 secret and an otpauth URI', async () => {
    const store = new TotpSecretStore();
    const app = buildApp(store);
    const res = await request(app)
      .post('/auth/totp/enroll')
      .send({ userId: 'user-1', email: 'user@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(res.body.otpauthUrl).toMatch(
      /^otpauth:\/\/totp\/Nextellar%3Auser%40example\.com\?/,
    );
    expect(store.inspect('user-1')?.state).toBe('pending');
  });
});

describe('POST /auth/totp/verify', () => {
  it('400s on a non-6-digit code', async () => {
    const store = new TotpSecretStore();
    store.startEnrollment('user-1');
    const app = buildApp(store);
    const res = await request(app)
      .post('/auth/totp/verify')
      .send({ userId: 'user-1', code: 'abc' });
    expect(res.status).toBe(400);
  });

  it('200s on a correct code and activates the enrolment', async () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);
    const code = generateTotp(secret);
    const app = buildApp(store);

    const res = await request(app)
      .post('/auth/totp/verify')
      .send({ userId: 'user-1', code });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, active: true });
  });

  it('rejects a replayed code with 401 and reason=replay', async () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);
    const code = generateTotp(secret);
    const app = buildApp(store);

    const first = await request(app)
      .post('/auth/totp/verify')
      .send({ userId: 'user-1', code });
    expect(first.status).toBe(200);

    const replay = await request(app)
      .post('/auth/totp/verify')
      .send({ userId: 'user-1', code });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({
      error: 'invalid totp code',
      reason: 'replay',
    });
  });
});

describe('POST /auth/totp/disable', () => {
  it('404s when TOTP is not active', async () => {
    const store = new TotpSecretStore();
    const app = buildApp(store);
    const res = await request(app)
      .post('/auth/totp/disable')
      .send({ userId: 'user-1', code: '123456' });
    expect(res.status).toBe(404);
  });

  it('400s on a malformed code', async () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);
    // Activate first.
    store.verifyAndConsume('user-1', generateTotp(secret));
    const app = buildApp(store);

    const res = await request(app)
      .post('/auth/totp/disable')
      .send({ userId: 'user-1', code: 'abc' });
    expect(res.status).toBe(400);
  });

  it('disables TOTP when the code is valid and not a replay', async () => {
    const store = new TotpSecretStore();
    const { record } = store.startEnrollment('user-1');
    const secret = decryptSecret(record.encrypted);

    // Activate the enrolment with a code from far in the past so the
    // current-time code is on a much later counter and cannot collide
    // with the activation counter (which would otherwise be rejected as
    // a replay).
    const farPast = 0;
    store.verifyAndConsume('user-1', generateTotp(secret, farPast), {
      timestampMs: farPast,
    });
    expect(store.isActive('user-1')).toBe(true);

    const app = buildApp(store);
    const currentCode = generateTotp(secret);
    const res = await request(app)
      .post('/auth/totp/disable')
      .send({ userId: 'user-1', code: currentCode });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(store.isActive('user-1')).toBe(false);
  });
});
