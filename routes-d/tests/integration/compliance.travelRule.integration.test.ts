/**
 * Integration test for the travel rule data exchange endpoint.
 *
 * Exercises the full submit → fetch flow end-to-end:
 *   1. Submit a travel rule record
 *   2. Fetch and verify PII is decrypted correctly
 *   3. Verify idempotent re-submission
 *   4. Verify unauthorized partner is rejected on both routes
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import travelRuleRouter, { __resetTravelRuleStore } from '../../routes/compliance.travelRule.js';
import {
  __registerTestPartner,
  __unregisterTestPartner,
  computeSignature,
  bodyDigest,
} from '../../auth/mutualAuth.js';
import { __setTestKey } from '../../lib/crypto.js';

const PARTNER_ID = 'vasp-integration';
const PARTNER_SECRET = 'integration-secret-12345';
const KEY_KID = 'intv1';
const KEY_HEX = '1'.repeat(64);

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(travelRuleRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function authHeaders(body: object = {}): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const digest = bodyDigest(JSON.stringify(body));
  const sig = computeSignature(PARTNER_ID, ts, digest, PARTNER_SECRET);
  return {
    'Content-Type': 'application/json',
    'x-partner-id': PARTNER_ID,
    'x-partner-ts': ts,
    'x-partner-sig': sig,
  };
}

function getAuthHeaders(): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const digest = bodyDigest('');
  const sig = computeSignature(PARTNER_ID, ts, digest, PARTNER_SECRET);
  return {
    'x-partner-id': PARTNER_ID,
    'x-partner-ts': ts,
    'x-partner-sig': sig,
  };
}

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

describe('Travel Rule integration', () => {
  it('end-to-end: submit then fetch decrypts PII correctly', async () => {
    const app = buildApp();

    const submitBody = {
      transferId: 'integration-tx-001',
      amount: 1_200,
      asset: 'XLM',
      originator: {
        name: 'Carol Originator',
        accountNumber: 'GCARO000001',
        address: '100 Blockchain Ave',
      },
      beneficiary: {
        name: 'Dave Beneficiary',
        accountNumber: 'GDAVE000001',
      },
    };

    // 1. Submit
    const submitRes = await request(app)
      .post('/compliance/travel-rule/transfers')
      .set(authHeaders(submitBody))
      .send(submitBody);

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.data.transferId).toBe('integration-tx-001');
    expect(submitRes.body.data.submittedBy).toBe(PARTNER_ID);

    // 2. Fetch – PII must come back as plaintext
    const fetchRes = await request(app)
      .get('/compliance/travel-rule/transfers/integration-tx-001')
      .set(getAuthHeaders());

    expect(fetchRes.status).toBe(200);

    const data = fetchRes.body.data;
    expect(data.transferId).toBe('integration-tx-001');
    expect(data.amount).toBe(1_200);
    expect(data.asset).toBe('XLM');
    expect(data.originator.name).toBe('Carol Originator');
    expect(data.originator.accountNumber).toBe('GCARO000001');
    expect(data.originator.address).toBe('100 Blockchain Ave');
    expect(data.beneficiary.name).toBe('Dave Beneficiary');
    expect(data.beneficiary.accountNumber).toBe('GDAVE000001');
  });

  it('idempotent re-submission returns 200 with duplicate flag', async () => {
    const app = buildApp();
    const body = {
      transferId: 'idem-tx-001',
      amount: 50,
      asset: 'USDC',
      originator: { name: 'Eve', accountNumber: 'GEVE000001' },
      beneficiary: { name: 'Frank', accountNumber: 'GFRANK001' },
    };

    await request(app)
      .post('/compliance/travel-rule/transfers')
      .set(authHeaders(body))
      .send(body)
      .expect(201);

    const res2 = await request(app)
      .post('/compliance/travel-rule/transfers')
      .set(authHeaders(body))
      .send(body);

    expect(res2.status).toBe(200);
    expect(res2.body.meta.duplicate).toBe(true);
  });

  it('rejects submit from unregistered partner', async () => {
    const app = buildApp();
    const body = {
      transferId: 'rogue-tx-001',
      amount: 100,
      asset: 'USDC',
      originator: { name: 'Rogue', accountNumber: 'GROGU001' },
      beneficiary: { name: 'Victim', accountNumber: 'GVICT001' },
    };

    const ts = String(Math.floor(Date.now() / 1000));
    const digest = bodyDigest(JSON.stringify(body));
    const sig = computeSignature('rogue-vasp', ts, digest, 'rogue-secret');

    const res = await request(app)
      .post('/compliance/travel-rule/transfers')
      .set({
        'Content-Type': 'application/json',
        'x-partner-id': 'rogue-vasp',
        'x-partner-ts': ts,
        'x-partner-sig': sig,
      })
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNKNOWN_PARTNER');
  });

  it('rejects fetch from unregistered partner', async () => {
    const app = buildApp();

    // First submit a valid record
    const body = {
      transferId: 'rogue-fetch-001',
      amount: 200,
      asset: 'USDC',
      originator: { name: 'Owner', accountNumber: 'GOWN001' },
      beneficiary: { name: 'Receiver', accountNumber: 'GREC001' },
    };

    await request(app)
      .post('/compliance/travel-rule/transfers')
      .set(authHeaders(body))
      .send(body)
      .expect(201);

    // Then try to fetch as an unknown partner
    const ts = String(Math.floor(Date.now() / 1000));
    const digest = bodyDigest('');
    const sig = computeSignature('rogue-vasp', ts, digest, 'any');

    const res = await request(app)
      .get('/compliance/travel-rule/transfers/rogue-fetch-001')
      .set({
        'x-partner-id': 'rogue-vasp',
        'x-partner-ts': ts,
        'x-partner-sig': sig,
      });

    expect(res.status).toBe(403);
  });
});
