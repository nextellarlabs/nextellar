/**
 * Unit tests for routes-d/auth/mutualAuth.ts
 */

import {
  computeSignature,
  bodyDigest,
  safeCompare,
  resolvePartnerSecret,
  requirePartner,
  __registerTestPartner,
  __unregisterTestPartner,
} from '../../auth/mutualAuth.js';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import type { PartnerRequest } from '../../auth/mutualAuth.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PARTNER_ID = 'exchange-test';
const PARTNER_SECRET = 'super-secret-value-for-tests-only';

beforeEach(() => {
  __registerTestPartner(PARTNER_ID, PARTNER_SECRET);
});

afterEach(() => {
  __unregisterTestPartner(PARTNER_ID);
});

// ── computeSignature ──────────────────────────────────────────────────────────

describe('computeSignature', () => {
  it('is deterministic for the same inputs', () => {
    const sig1 = computeSignature(PARTNER_ID, '1000000', 'aabbcc', PARTNER_SECRET);
    const sig2 = computeSignature(PARTNER_ID, '1000000', 'aabbcc', PARTNER_SECRET);
    expect(sig1).toBe(sig2);
  });

  it('differs when any input changes', () => {
    const base = computeSignature(PARTNER_ID, '1000000', 'aabbcc', PARTNER_SECRET);
    const diffPartner = computeSignature('other-exchange', '1000000', 'aabbcc', PARTNER_SECRET);
    const diffTs = computeSignature(PARTNER_ID, '9999999', 'aabbcc', PARTNER_SECRET);
    const diffDigest = computeSignature(PARTNER_ID, '1000000', '112233', PARTNER_SECRET);
    const diffSecret = computeSignature(PARTNER_ID, '1000000', 'aabbcc', 'different-secret');

    expect(base).not.toBe(diffPartner);
    expect(base).not.toBe(diffTs);
    expect(base).not.toBe(diffDigest);
    expect(base).not.toBe(diffSecret);
  });

  it('returns a 64-character hex string (SHA-256 HMAC)', () => {
    const sig = computeSignature(PARTNER_ID, '100', 'abc', PARTNER_SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── bodyDigest ────────────────────────────────────────────────────────────────

describe('bodyDigest', () => {
  it('returns a 64-char hex string for any input', () => {
    expect(bodyDigest('hello')).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyDigest(Buffer.from('hello'))).toMatch(/^[0-9a-f]{64}$/);
    expect(bodyDigest('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical for same content as string vs Buffer', () => {
    const str = bodyDigest('test body');
    const buf = bodyDigest(Buffer.from('test body', 'utf8'));
    expect(str).toBe(buf);
  });
});

// ── safeCompare ───────────────────────────────────────────────────────────────

describe('safeCompare', () => {
  it('returns true for identical hex strings', () => {
    const sig = computeSignature(PARTNER_ID, '1', 'x', PARTNER_SECRET);
    expect(safeCompare(sig, sig)).toBe(true);
  });

  it('returns false for different length strings', () => {
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });

  it('returns false for different hex strings of same length', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(safeCompare(a, b)).toBe(false);
  });
});

// ── resolvePartnerSecret ──────────────────────────────────────────────────────

describe('resolvePartnerSecret', () => {
  it('returns the secret for a registered partner', () => {
    expect(resolvePartnerSecret(PARTNER_ID)).toBe(PARTNER_SECRET);
  });

  it('returns undefined for an unknown partner', () => {
    expect(resolvePartnerSecret('unknown-partner')).toBeUndefined();
  });
});

// ── requirePartner middleware (via supertest) ─────────────────────────────────

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.post(
    '/test',
    requirePartner as (req: Request, res: Response, next: NextFunction) => void,
    (req: Request, res: Response) => {
      res.status(200).json({ partnerId: (req as PartnerRequest).partnerId });
    },
  );
  return app;
}

/** Builds a valid set of auth headers for a given body at the current time. */
function validHeaders(body: object = {}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = bodyDigest(JSON.stringify(body));
  const sig = computeSignature(PARTNER_ID, timestamp, digest, PARTNER_SECRET);
  return {
    'x-partner-id': PARTNER_ID,
    'x-partner-ts': timestamp,
    'x-partner-sig': sig,
  };
}

describe('requirePartner middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('accepts a valid partner request and sets req.partnerId', async () => {
    const body = { foo: 'bar' };
    const res = await request(app).post('/test').set(validHeaders(body)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.partnerId).toBe(PARTNER_ID);
  });

  it('returns 401 when X-Partner-Id header is missing', async () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)['x-partner-id'];
    const res = await request(app).post('/test').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_AUTH_HEADERS');
  });

  it('returns 401 when X-Partner-Sig header is missing', async () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)['x-partner-sig'];
    const res = await request(app).post('/test').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_AUTH_HEADERS');
  });

  it('returns 401 when X-Partner-Ts header is missing', async () => {
    const headers = validHeaders();
    delete (headers as Record<string, string>)['x-partner-ts'];
    const res = await request(app).post('/test').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_AUTH_HEADERS');
  });

  it('returns 401 when timestamp is non-numeric', async () => {
    const headers = validHeaders();
    (headers as Record<string, string>)['x-partner-ts'] = 'not-a-number';
    const res = await request(app).post('/test').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TIMESTAMP');
  });

  it('returns 401 when timestamp is too old', async () => {
    const body = {};
    const oldTs = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
    const digest = bodyDigest(JSON.stringify(body));
    const sig = computeSignature(PARTNER_ID, oldTs, digest, PARTNER_SECRET);
    const res = await request(app)
      .post('/test')
      .set({
        'x-partner-id': PARTNER_ID,
        'x-partner-ts': oldTs,
        'x-partner-sig': sig,
      })
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REQUEST_EXPIRED');
  });

  it('returns 403 when partner id is unknown', async () => {
    const body = {};
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = bodyDigest(JSON.stringify(body));
    const sig = computeSignature('unknown-partner', timestamp, digest, PARTNER_SECRET);
    const res = await request(app)
      .post('/test')
      .set({
        'x-partner-id': 'unknown-partner',
        'x-partner-ts': timestamp,
        'x-partner-sig': sig,
      })
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNKNOWN_PARTNER');
  });

  it('returns 401 when signature is wrong', async () => {
    const headers = validHeaders({ foo: 'bar' });
    (headers as Record<string, string>)['x-partner-sig'] = 'f'.repeat(64);
    const res = await request(app).post('/test').set(headers).send({ foo: 'bar' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });
});
