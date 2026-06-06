/**
 * End-to-end tests for the Stellar wallet challenge-response flow.
 *
 * Strategy
 * --------
 * - All tests run in-process against an Express app built from
 *   `createWalletAuthRouter()` — no network I/O, no Docker.
 * - A **deterministic** ed25519 key pair derived from fixed RFC 8037
 *   test-vector seed bytes is used so failures are reproducible.
 * - The signature verifier is the same `nodeEd25519Verifier` used in
 *   production; only the challenge store is cleared between tests.
 *
 * Scenarios covered
 * -----------------
 *   1. Successful login — challenge → sign → verify → session cookie
 *   2. Nonce reuse (replay attack) → 401 already_used
 *   3. Expired nonce → 401 expired
 *   4. Bad signature (different key) → 401 bad_signature
 *   5. Missing fields → 400
 *   6. Gated route accessible with session cookie
 *   7. Gated route rejects unauthenticated request
 */

import crypto from 'node:crypto';
import request from 'supertest';
import express from 'express';
import { createWalletAuthRouter } from '../routes/auth.wallet.js';
import { challengeStore } from '../auth/walletChallenge.js';
import { verifySessionToken } from '../lib/session.js';

// ---------------------------------------------------------------------------
// Deterministic test keypair (RFC 8037 §A test vector)
// Raw private key bytes: d4ee72dbf913584ad5b6d8f1f769f8ad3afe7c28cbf1d4fbe097a88f44755842
// Corresponding public key bytes: 19bf44096984cdfe8541bac167dc3b96c85086aa30b6b6cb0c5c38ad703166e1
// ---------------------------------------------------------------------------

const PKCS8_DER = Buffer.from(
  '302e020100300506032b657004220420' +
    'd4ee72dbf913584ad5b6d8f1f769f8ad3afe7c28cbf1d4fbe097a88f44755842',
  'hex',
);

const SPKI_DER = Buffer.from(
  '302a300506032b6570032100' +
    '19bf44096984cdfe8541bac167dc3b96c85086aa30b6b6cb0c5c38ad703166e1',
  'hex',
);

const TEST_PRIVATE_KEY = crypto.createPrivateKey({ key: PKCS8_DER, format: 'der', type: 'pkcs8' });
const TEST_PUBLIC_KEY_HEX = '19bf44096984cdfe8541bac167dc3b96c85086aa30b6b6cb0c5c38ad703166e1';

function signNonce(nonce: string): string {
  const sig = crypto.sign(null, Buffer.from(nonce, 'utf8'), TEST_PRIVATE_KEY);
  return sig.toString('hex');
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createWalletAuthRouter());

  // Minimal gated route: read session cookie and verify it
  app.get('/api/me', (req, res) => {
    const raw = req.headers.cookie ?? '';
    const match = raw.match(/(?:^|;\s*)session=([^;]+)/);
    const token = match?.[1] ?? '';
    const claims = verifySessionToken(token);
    if (!claims) return res.status(401).json({ error: 'unauthorized' });
    return res.status(200).json({ accountId: claims.sub });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  challengeStore.clear();
});

// ---------------------------------------------------------------------------
// GET /auth/wallet/challenge
// ---------------------------------------------------------------------------

describe('GET /auth/wallet/challenge', () => {
  it('returns a nonce for a valid public key', async () => {
    const res = await request(buildApp())
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });

    expect(res.status).toBe(200);
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(0);
    expect(challengeStore.size).toBe(1);
  });

  it('returns 400 when the account param is missing', async () => {
    const res = await request(buildApp()).get('/auth/wallet/challenge');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when the account param is empty string', async () => {
    const res = await request(buildApp())
      .get('/auth/wallet/challenge')
      .query({ account: '' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/wallet/verify — successful login
// ---------------------------------------------------------------------------

describe('POST /auth/wallet/verify — successful login', () => {
  it('issues a session cookie when nonce + signature are valid', async () => {
    const app = buildApp();

    const challengeRes = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });
    const { nonce } = challengeRes.body as { nonce: string };

    const verifyRes = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce, signature: signNonce(nonce) });

    expect(verifyRes.status).toBe(200);
    expect(typeof verifyRes.body.token).toBe('string');
    expect(typeof verifyRes.body.expiresAt).toBe('number');
    expect(verifyRes.body.accountId).toBe(TEST_PUBLIC_KEY_HEX);
    const cookies = verifyRes.headers['set-cookie'];
    expect(Array.isArray(cookies) ? cookies.join() : cookies).toContain('session=');
  });

  it('marks the nonce as used after a successful verification', async () => {
    const app = buildApp();
    const { body } = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });

    await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce, signature: signNonce(body.nonce) });

    const record = challengeStore.get(body.nonce);
    expect(record?.used).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nonce reuse (replay attack)
// ---------------------------------------------------------------------------

describe('POST /auth/wallet/verify — nonce reuse', () => {
  it('rejects a second use of the same nonce with 401 already_used', async () => {
    const app = buildApp();
    const { body } = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });
    const sig = signNonce(body.nonce);

    const first = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce, signature: sig });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce, signature: sig });
    expect(second.status).toBe(401);
    expect(second.body.error).toBe('already_used');
  });
});

// ---------------------------------------------------------------------------
// Expired nonce
// ---------------------------------------------------------------------------

describe('POST /auth/wallet/verify — expired nonce', () => {
  it('rejects a nonce whose expiresAt is in the past with 401 expired', async () => {
    const expiredNonce = 'chal_expired_deterministic';
    challengeStore.set(expiredNonce, {
      nonce: expiredNonce,
      publicKey: TEST_PUBLIC_KEY_HEX,
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1,   // already past
      used: false,
    });

    const res = await request(buildApp())
      .post('/auth/wallet/verify')
      .send({ nonce: expiredNonce, signature: signNonce(expiredNonce) });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('expired');
  });

  it('marks an expired nonce as used to prevent further reuse', async () => {
    const expiredNonce = 'chal_expired_mark_used';
    challengeStore.set(expiredNonce, {
      nonce: expiredNonce,
      publicKey: TEST_PUBLIC_KEY_HEX,
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1,
      used: false,
    });

    await request(buildApp())
      .post('/auth/wallet/verify')
      .send({ nonce: expiredNonce, signature: signNonce(expiredNonce) });

    expect(challengeStore.get(expiredNonce)?.used).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bad / malformed signature
// ---------------------------------------------------------------------------

describe('POST /auth/wallet/verify — bad signature', () => {
  it('rejects a signature from a different key with 401 bad_signature', async () => {
    const app = buildApp();
    const { body } = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });

    // Generate a different one-off key pair for the wrong signature
    const { privateKey: wrongKey } = crypto.generateKeyPairSync('ed25519');
    const wrongSig = crypto
      .sign(null, Buffer.from(body.nonce, 'utf8'), wrongKey)
      .toString('hex');

    const res = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce, signature: wrongSig });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_signature');
  });

  it('rejects a signature over a different message', async () => {
    const app = buildApp();
    const { body } = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });

    const wrongSig = signNonce('not-the-nonce');

    const res = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce, signature: wrongSig });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_signature');
  });

  it('returns 400 when signature field is missing', async () => {
    const app = buildApp();
    const { body } = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });

    const res = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce: body.nonce });

    expect(res.status).toBe(400);
  });

  it('returns 400 when nonce field is missing', async () => {
    const res = await request(buildApp())
      .post('/auth/wallet/verify')
      .send({ signature: '00'.repeat(64) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Unknown nonce
// ---------------------------------------------------------------------------

describe('POST /auth/wallet/verify — unknown nonce', () => {
  it('returns 401 unknown_nonce when the nonce was never issued', async () => {
    const res = await request(buildApp())
      .post('/auth/wallet/verify')
      .send({ nonce: 'chal_never_issued', signature: '00'.repeat(64) });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unknown_nonce');
  });
});

// ---------------------------------------------------------------------------
// Gated route session usability
// ---------------------------------------------------------------------------

describe('Gated route after wallet login', () => {
  it('grants access to the gated route using the session cookie', async () => {
    const app = buildApp();

    const challengeRes = await request(app)
      .get('/auth/wallet/challenge')
      .query({ account: TEST_PUBLIC_KEY_HEX });
    const { nonce } = challengeRes.body as { nonce: string };

    const verifyRes = await request(app)
      .post('/auth/wallet/verify')
      .send({ nonce, signature: signNonce(nonce) });

    const cookieHeader = verifyRes.headers['set-cookie'] as string | string[];
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    const sessionCookie = cookie.split(';')[0];

    const meRes = await request(app)
      .get('/api/me')
      .set('Cookie', sessionCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.accountId).toBe(TEST_PUBLIC_KEY_HEX);
  });

  it('blocks requests to the gated route without a session cookie', async () => {
    const res = await request(buildApp()).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('blocks requests with a tampered session token', async () => {
    const res = await request(buildApp())
      .get('/api/me')
      .set('Cookie', 'session=tampered.token.here');
    expect(res.status).toBe(401);
  });
});