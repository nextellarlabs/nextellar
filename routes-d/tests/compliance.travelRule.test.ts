/**
 * Route tests for routes-d/routes/compliance.travelRule.ts
 *
 * Covers:
 *   - POST /compliance/travel-rule/transfers (submit)
 *   - GET  /compliance/travel-rule/transfers/:transferId (fetch)
 *   - Unauthorized partner rejection
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import travelRuleRouter, { __resetTravelRuleStore } from '../routes/compliance.travelRule.js';
import { __resetTravelRuleStore as resetStore } from '../routes/compliance.travelRule.js';
import {
  __registerTestPartner,
  __unregisterTestPartner,
  computeSignature,
  bodyDigest,
} from '../auth/mutualAuth.js';
import { __setTestKey } from '../lib/crypto.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PARTNER_ID = 'vasp-alpha';
const PARTNER_SECRET = 'test-secret-for-travel-rule-route';
const KEY_KID = 'trv1';
const KEY_HEX = '0'.repeat(64);

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(travelRuleRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function validHeaders(body: object = {}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = bodyDigest(JSON.stringify(body));
  const sig = computeSignature(PARTNER_ID, timestamp, digest, PARTNER_SECRET);
  return {
    'Content-Type': 'application/json',
    'x-partner-id': PARTNER_ID,
    'x-partner-ts': timestamp,
    'x-partner-sig': sig,
  };
}

const VALID_PAYLOAD = {
  transferId: 'tr-001',
  amount: 500,
  asset: 'USDC',
  originator: {
    name: 'Alice Originator',
    accountNumber: 'GABC1234567890',
    address: '1 Main St',
  },
  beneficiary: {
    name: 'Bob Beneficiary',
    accountNumber: 'GXYZ9876543210',
  },
};

beforeAll(() => {
  __registerTestPartner(PARTNER_ID, PARTNER_SECRET);
  __setTestKey(KEY_KID, KEY_HEX);
  process.env.TRAVEL_RULE_KEY_ACTIVE = KEY_KID;
});

afterAll(() => {
  __unregisterTestPartner(PARTNER_ID);
  delete process.env.TRAVEL_RULE_KEY_ACTIVE;
  delete process.env[`TRAVEL_RULE_KEY_${KEY_KID.toUpperCase()}`];
});

beforeEach(() => {
  __resetTravelRuleStore();
});

describe('compliance travel rule routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  // ── POST /compliance/travel-rule/transfers ─────────────────────────────────

  describe('POST /compliance/travel-rule/transfers', () => {
    it('creates a record and returns 201 with summary (no PII)', async () => {
      const body = { ...VALID_PAYLOAD };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transferId).toBe('tr-001');
      expect(res.body.data.amount).toBe(500);
      expect(res.body.data.asset).toBe('USDC');
      expect(res.body.data.submittedBy).toBe(PARTNER_ID);

      // PII must NOT be present in the creation response
      expect(res.body.data.originator).toBeUndefined();
      expect(res.body.data.beneficiary).toBeUndefined();
    });

    it('returns 200 with duplicate flag when the same transferId is submitted twice', async () => {
      const body = { ...VALID_PAYLOAD };
      await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body)
        .expect(201);

      const res2 = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res2.status).toBe(200);
      expect(res2.body.meta.duplicate).toBe(true);
      expect(res2.body.data.transferId).toBe('tr-001');
    });

    it('returns 400 when transferId is missing', async () => {
      const body = { ...VALID_PAYLOAD, transferId: '' };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when amount is zero or negative', async () => {
      const body = { ...VALID_PAYLOAD, transferId: 'tr-002', amount: -1 };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when asset is missing', async () => {
      const body = { ...VALID_PAYLOAD, transferId: 'tr-003', asset: '' };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when originator is missing accountNumber', async () => {
      const body = {
        ...VALID_PAYLOAD,
        transferId: 'tr-004',
        originator: { name: 'Alice' },
      };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when beneficiary is missing name', async () => {
      const body = {
        ...VALID_PAYLOAD,
        transferId: 'tr-005',
        beneficiary: { accountNumber: 'GABC' },
      };
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 when auth headers are absent', async () => {
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_AUTH_HEADERS');
    });

    it('returns 403 for an unregistered partner', async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = { ...VALID_PAYLOAD };
      const digest = bodyDigest(JSON.stringify(body));
      const sig = computeSignature('rouge-vasp', timestamp, digest, 'any-secret');

      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set({
          'Content-Type': 'application/json',
          'x-partner-id': 'rouge-vasp',
          'x-partner-ts': timestamp,
          'x-partner-sig': sig,
        })
        .send(body);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('UNKNOWN_PARTNER');
    });

    it('returns 401 when signature does not match', async () => {
      const headers = validHeaders(VALID_PAYLOAD);
      headers['x-partner-sig'] = 'e'.repeat(64);
      const res = await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(headers)
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });
  });

  // ── GET /compliance/travel-rule/transfers/:transferId ──────────────────────

  describe('GET /compliance/travel-rule/transfers/:transferId', () => {
    /** Auth headers for GET requests (no body → empty string digest). */
    function getHeaders(): Record<string, string> {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const digest = bodyDigest('');
      const sig = computeSignature(PARTNER_ID, timestamp, digest, PARTNER_SECRET);
      return {
        'x-partner-id': PARTNER_ID,
        'x-partner-ts': timestamp,
        'x-partner-sig': sig,
      };
    }

    async function submitRecord(): Promise<void> {
      const body = { ...VALID_PAYLOAD };
      await request(app)
        .post('/compliance/travel-rule/transfers')
        .set(validHeaders(body))
        .send(body)
        .expect(201);
    }

    it('returns 200 with decrypted PII for an existing record', async () => {
      await submitRecord();

      const res = await request(app)
        .get('/compliance/travel-rule/transfers/tr-001')
        .set(getHeaders());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.transferId).toBe('tr-001');
      expect(data.amount).toBe(500);
      expect(data.asset).toBe('USDC');

      // PII must be decrypted (plain strings, not EncryptedField objects)
      expect(data.originator.name).toBe('Alice Originator');
      expect(data.originator.accountNumber).toBe('GABC1234567890');
      expect(data.originator.address).toBe('1 Main St');
      expect(data.beneficiary.name).toBe('Bob Beneficiary');
      expect(data.beneficiary.accountNumber).toBe('GXYZ9876543210');
    });

    it('returns 404 for a non-existent transferId', async () => {
      const res = await request(app)
        .get('/compliance/travel-rule/transfers/unknown-id')
        .set(getHeaders());

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when auth headers are absent on fetch', async () => {
      await submitRecord();
      const res = await request(app).get('/compliance/travel-rule/transfers/tr-001');
      expect(res.status).toBe(401);
    });

    it('returns 403 for an unregistered partner on fetch', async () => {
      await submitRecord();

      const timestamp = String(Math.floor(Date.now() / 1000));
      const digest = bodyDigest('');
      const sig = computeSignature('rogue-vasp', timestamp, digest, 'any');

      const res = await request(app)
        .get('/compliance/travel-rule/transfers/tr-001')
        .set({
          'x-partner-id': 'rogue-vasp',
          'x-partner-ts': timestamp,
          'x-partner-sig': sig,
        });

      expect(res.status).toBe(403);
    });
  });
});
