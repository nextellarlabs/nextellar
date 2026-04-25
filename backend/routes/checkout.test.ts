import request from 'supertest';
import app from '../app.js';

describe('POST /checkout', () => {
  it('should commit all writes on success', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({
        order: { userId: 'user-1', amount: 100 },
        productId: 'prod-1',
        quantity: 2,
        payment: { amount: 100, method: 'card' }
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.inventory).toBeDefined();
    expect(res.body.payment).toBeDefined();
  });

  it('should rollback all writes on payment failure', async () => {
    const res = await request(app)
      .post('/checkout')
      .send({
        order: { userId: 'user-1', amount: 100 },
        productId: 'prod-1',
        quantity: 2,
        payment: { amount: 100, method: 'card', fail: true }
      });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/payment failed/i);
    // In a real test, check DB for no order/inventory change
  });
});
