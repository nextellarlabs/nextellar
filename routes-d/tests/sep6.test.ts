import request from 'supertest';
import express from 'express';
import { deposit } from '../routes/sep6.deposit.js';
import { withdraw } from '../routes/sep6.withdraw.js';

const app = express();
app.use(express.json());

app.post('/sep6/deposit', deposit);
app.post('/sep6/withdraw', withdraw);

describe('SEP-6 Deposit & Withdraw', () => {
  test('should initiate deposit with valid data', async () => {
    const res = await request(app)
      .post('/sep6/deposit')
      .send({
        asset_code: 'USDC',
        amount: '100',
        account: 'GABC...',
        user_id: 'user123'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  test('should reject deposit without KYC', async () => {
    const res = await request(app)
      .post('/sep6/deposit')
      .send({
        asset_code: 'USDC',
        amount: '100',
        account: 'GABC...'
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('KYC');
  });

  test('should initiate withdrawal', async () => {
    const res = await request(app)
      .post('/sep6/withdraw')
      .send({
        asset_code: 'XLM',
        amount: '50',
        dest: 'bank_account_123',
        account: 'GABC...',
        user_id: 'user123'
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_user_transfer_start');
  });
});