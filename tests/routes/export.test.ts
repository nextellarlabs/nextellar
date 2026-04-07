import request from 'supertest';
import app from '../../backend/app.js';
import { signToken } from '../../backend/auth/token.js';

describe('GET /export', () => {
  const validToken = signToken({ id: '1', username: 'alice', role: 'admin' });

  it('should return 401 if Authorization header is missing', async () => {
    const response = await request(app).get('/export');
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/missing or invalid token/i);
  });

  it('should return 401 if token is passed via query parameter (token=...) but no header', async () => {
    const response = await request(app).get(`/export?token=${validToken}`);
    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/missing or invalid token/i);
  });

  it('should return 401 if Authorization header is invalid', async () => {
    const response = await request(app)
      .get('/export')
      .set('Authorization', 'InvalidToken');
    expect(response.status).toBe(401);
  });

  it('should return 200 and data if valid Authorization header is provided', async () => {
    const response = await request(app)
      .get('/export')
      .set('Authorization', `Bearer ${validToken}`);
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('should still return 200 if valid token is in header, even if a token is ALSO in query (query should be ignored)', async () => {
    // This verifies the header-first policy. If header is valid, request succeeds.
    // The query token is simply not used for auth.
    const response = await request(app)
      .get(`/export?token=some-other-token`)
      .set('Authorization', `Bearer ${validToken}`);
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
