import request from 'supertest';
import app from '../../backend/app.js';
import { authDeps } from '../../backend/routes/auth.js';

// Setup environment for testing
process.env.JWT_SECRET = 'test-secret-12345678901234567890123456789012';

describe('Security and Robustness Verification', () => {

  describe('Issue #229: Auth Failure Logging', () => {
    it('logs failed login attempts and returns 401', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[AUTH_FAILURE]'));
      
      const logCall = consoleSpy.mock.calls.find(call => call[0].includes('[AUTH_FAILURE]'));
      const logEntry = JSON.parse(logCall![0].split('[AUTH_FAILURE] ')[1]);
      
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry.username).toBe('testuser');
      expect(logEntry.reason).toBe('invalid_credentials');
      expect(logEntry).not.toHaveProperty('password');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Issue #228: Shipping Address Null Guard', () => {
    // Note: We need a valid token to bypass 'authenticate' middleware
    // For this test, we'll mock the internal behavior if possible, or use a real signed token
    const sign = (payload: any) => {
      const jwt = require('jsonwebtoken');
      return jwt.sign(payload, process.env.JWT_SECRET);
    };

    it('returns 200 and city for User 1 (full profile)', async () => {
      const token = sign({ userId: '1', role: 'user' });
      const res = await request(app)
        .get('/shipping')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.city).toBe('San Francisco');
    });

    it('returns 404 for User 2 (profile but no address)', async () => {
      const token = sign({ userId: '2', role: 'user' });
      const res = await request(app)
        .get('/shipping')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No shipping address found');
    });

    it('returns 404 for User 3 (no profile)', async () => {
      const token = sign({ userId: '3', role: 'user' });
      const res = await request(app)
        .get('/shipping')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No shipping address found');
    });
  });

  describe('Issue #226: CSRF Protection', () => {
    const sign = (payload: any) => {
      const jwt = require('jsonwebtoken');
      return jwt.sign(payload, process.env.JWT_SECRET);
    };

    it('rejects POST /settings/update without valid origin/referer', async () => {
      const token = sign({ userId: '1', role: 'user' });
      const res = await request(app)
        .post('/settings/update')
        .set('Authorization', `Bearer ${token}`)
        .send({ theme: 'dark' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden: missing security headers');
    });

    it('accepts POST /settings/update with valid origin', async () => {
      const token = sign({ userId: '1', role: 'user' });
      const res = await request(app)
        .post('/settings/update')
        .set('Authorization', `Bearer ${token}`)
        .set('Origin', 'http://localhost:3000')
        .send({ theme: 'dark' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Issue #225: Transfer Amount Validation', () => {
    it('rejects non-integer amounts', async () => {
      const res = await request(app)
        .post('/transfer')
        .send({ amount: 12.5, destination: '0x123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid amount format');
    });

    it('rejects negative amounts', async () => {
      const res = await request(app)
        .post('/transfer')
        .send({ amount: -100, destination: '0x123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('positive integer');
    });

    it('rejects amounts exceeding cap (1,000,000)', async () => {
      const res = await request(app)
        .post('/transfer')
        .send({ amount: 1000001, destination: '0x123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('exceeds the maximum limit');
    });

    it('accepts valid integer amount within cap', async () => {
      const res = await request(app)
        .post('/transfer')
        .send({ amount: 500000, destination: '0x123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(500000);
    });
  });
});
