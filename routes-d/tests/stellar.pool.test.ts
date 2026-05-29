import request from 'supertest';
import Router from 'express';
import depositRouter from '../routes/stellar.pool.deposit.js';

const app = Router();
app.use(Router.json());
app.use(depositRouter);

describe('Stellar Pool Routes', () => {
  describe('POST /stellar/pool/deposit', () => {
    it('should validate missing required parameters', async () => {
      const res = await request(app)
        .post('/stellar/pool/deposit')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should return deposit envelope for valid input', async () => {
      const res = await request(app)
        .post('/stellar/pool/deposit')
        .send({
          poolId: 'test-pool-123',
          assetA: 'USDC:issuer',
          assetB: 'NATIVE',
          amountA: '100.00',
          slippageTolerance: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.envelope).toBeDefined();
    });

    it('should reject invalid slippage tolerance', async () => {
      const res = await request(app)
        .post('/stellar/pool/deposit')
        .send({
          poolId: 'test-pool-123',
          assetA: 'USDC:issuer',
          assetB: 'NATIVE',
          amountA: '100.00',
          slippageTolerance: 150,
        });

      expect(res.status).toBe(400);
    });

    it('should reject invalid pool id', async () => {
      const res = await request(app)
        .post('/stellar/pool/deposit')
        .send({
          poolId: 'nonexistent-pool',
          assetA: 'USDC:issuer',
          assetB: 'NATIVE',
          amountA: '100.00',
          slippageTolerance: 5,
        });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /stellar/pool/withdraw', () => {
    it('should validate missing required parameters', async () => {
      const res = await request(app)
        .post('/stellar/pool/withdraw')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return withdraw envelope for valid input', async () => {
      const res = await request(app)
        .post('/stellar/pool/withdraw')
        .send({
          poolId: 'test-pool-123',
          shareAmount: '50.00',
          slippageTolerance: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.envelope).toBeDefined();
    });
  });
});
