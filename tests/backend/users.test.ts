import request from 'supertest';
import app from '../../backend/app.js';
import { users } from '../../backend/routes/users.js';

const VALID_TOKEN = 'Bearer test-token-123';

beforeEach(() => {
  // Reset the user store to a known state before each test.
  users.clear();
  users.set('1', { id: '1', name: 'Alice' });
  users.set('2', { id: '2', name: 'Bob' });
});

describe('DELETE /users/:id', () => {
  it('deletes a user and returns 200 when authenticated', async () => {
    const res = await request(app)
      .delete('/users/1')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'User 1 deleted successfully' });
    expect(users.has('1')).toBe(false);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).delete('/users/1');

    expect(res.status).toBe(401);
    expect(users.has('1')).toBe(true);
  });

  it('returns 401 when token format is invalid (no Bearer prefix)', async () => {
    const res = await request(app)
      .delete('/users/1')
      .set('Authorization', 'invalid-token');

    expect(res.status).toBe(401);
    expect(users.has('1')).toBe(true);
  });

  it('returns 404 when user does not exist', async () => {
    const res = await request(app)
      .delete('/users/999')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
  });
});

describe('GET /users/delete/:id (removed endpoint)', () => {
  it('returns 404 — the old unsafe GET delete route must not exist', async () => {
    const res = await request(app)
      .get('/users/delete/1')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(404);
    // User must not have been deleted
    expect(users.has('1')).toBe(true);
  });
});
