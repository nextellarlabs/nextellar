import { addSigner, removeSigner, updateThresholds } from '../routes/stellar.signers.js';
import request from 'supertest';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/stellar/signers/add', addSigner);
app.post('/stellar/signers/remove', removeSigner);
app.post('/stellar/signers/update', updateThresholds);

describe('Stellar Multisig Signers', () => {
  test('should add signer with valid weight', async () => {
    const res = await request(app)
      .post('/stellar/signers/add')
      .send({
        sourceAccount: 'GABC...',
        signerPublicKey: 'GDXY...',
        weight: 1
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.unsignedXdr).toBeDefined();
  });

  test('should reject invalid weight', async () => {
    const res = await request(app)
      .post('/stellar/signers/add')
      .send({
        sourceAccount: 'GABC...',
        signerPublicKey: 'GDXY...',
        weight: 300
      });

    expect(res.status).toBe(400);
  });

  // More tests for remove, update, threshold conflicts, etc.
});