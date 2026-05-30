import express from 'express';
import request from 'supertest';
import sep31Router from '../routes/sep31.transactions.js';
import { validateSep31Transaction } from '../lib/sep31Validator.js';
import { sep31Deps, sep31TransactionStore } from '../lib/sep31Store.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(sep31Router);
  return app;
}

const validPayload = {
  asset_code: 'USDC',
  asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUFT3NY5DATXG2W5OTKGW2UV7JQ3SV',
  amount: '100.50',
  destination_account: 'GCFXHW46C2XYZ2PBFH7K5R7PQHEEXZMLQBRDLB7EMK5SO5WSDPCG3F7F',
  destination_memo: 'ref-001',
  destination_memo_type: 'text' as const,
  fields: {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    country: 'US',
  },
};

describe('SEP-31 validator', () => {
  it('accepts valid counterparty info', () => {
    const result = validateSep31Transaction(validPayload);
    expect(result.valid).toBe(true);
  });

  it('rejects missing counterparty fields', () => {
    const result = validateSep31Transaction({
      ...validPayload,
      fields: { email: 'bad-email', country: 'USA' },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field.includes('first_name'))).toBe(true);
      expect(result.errors.some((e) => e.field.includes('email'))).toBe(true);
      expect(result.errors.some((e) => e.field.includes('country'))).toBe(true);
    }
  });
});

describe('SEP-31 transaction routes', () => {
  const app = buildApp();
  let webhookMock: jest.Mock;

  beforeEach(() => {
    sep31TransactionStore.clear();
    webhookMock = jest.fn().mockResolvedValue(undefined);
    sep31Deps.dispatchSettlementWebhook = webhookMock;
  });

  it('submits a valid SEP-31 transaction', async () => {
    const res = await request(app)
      .post('/sep31/transactions')
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('pending');
  });

  it('returns validation errors for invalid payload', async () => {
    const res = await request(app)
      .post('/sep31/transactions')
      .send({ asset_code: 'USDC' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });

  it('queries transaction status', async () => {
    const submit = await request(app)
      .post('/sep31/transactions')
      .send(validPayload);

    const res = await request(app).get(`/sep31/transactions/${submit.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.amount).toBe('100.50');
  });

  it('emits settlement webhook on confirmation', async () => {
    const submit = await request(app)
      .post('/sep31/transactions')
      .send(validPayload);

    const id = submit.body.data.id;

    const confirm = await request(app).post(`/sep31/transactions/${id}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('completed');
    expect(webhookMock).toHaveBeenCalledTimes(1);
    expect(webhookMock.mock.calls[0][0].transactionId).toBe(id);
  });
});
