// Tests for the order history endpoint (#302).
// Covers empty history, own history, unauthorized access, and pagination.

import express, { type Express } from 'express';
import request from 'supertest';
import {
  createOrdersHistoryRouter,
  type CallerIdentity,
  type OrderHistoryEntry,
  type OrderHistoryPage,
  type OrderHistoryStore,
} from '../routes/orders.history.js';

// ---------------------------------------------------------------------------
// In-memory store used by tests
// ---------------------------------------------------------------------------

class InMemoryOrderHistoryStore implements OrderHistoryStore {
  private entries: OrderHistoryEntry[] = [];

  add(entry: OrderHistoryEntry): void {
    this.entries.push(entry);
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<OrderHistoryPage> {
    const owned = this.entries
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt); // newest first

    const total = owned.length;
    const offset = (page - 1) * pageSize;
    const results = owned.slice(offset, offset + pageSize);
    const hasNextPage = offset + pageSize < total;

    return { results, total, page, pageSize, hasNextPage };
  }
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function buildApp(
  identity: CallerIdentity | null,
  store: InMemoryOrderHistoryStore,
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/orders',
    createOrdersHistoryRouter({
      store,
      getIdentity: () => identity,
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  userId: string,
  createdAt: number,
): OrderHistoryEntry {
  return { id, userId, status: 'paid', amount: 100, createdAt };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /orders/history', () => {
  it('returns empty history when the user has no orders', async () => {
    const store = new InMemoryOrderHistoryStore();
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      total: 0,
      results: [],
      hasNextPage: false,
    });
  });

  it('returns only the authenticated user own orders', async () => {
    const store = new InMemoryOrderHistoryStore();
    store.add(makeEntry('a1', 'alice', 3000));
    store.add(makeEntry('a2', 'alice', 2000));
    store.add(makeEntry('a3', 'alice', 1000));
    store.add(makeEntry('b1', 'bob', 5000));
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.results.every((o: { userId: string }) => o.userId === 'alice')).toBe(true);
  });

  it('sorts results newest first', async () => {
    const store = new InMemoryOrderHistoryStore();
    store.add(makeEntry('e1', 'alice', 1000));
    store.add(makeEntry('e2', 'alice', 3000));
    store.add(makeEntry('e3', 'alice', 2000));
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history');

    expect(res.status).toBe(200);
    const createdAts: number[] = res.body.results.map((o: { createdAt: number }) => o.createdAt);
    expect(createdAts).toEqual([3000, 2000, 1000]);
  });

  it('returns 401 when getIdentity returns null', async () => {
    const store = new InMemoryOrderHistoryStore();
    const app = buildApp(null, store);

    const res = await request(app).get('/orders/history');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('paginates: page 1 with pageSize 2 returns 2 results with hasNextPage', async () => {
    const store = new InMemoryOrderHistoryStore();
    for (let i = 0; i < 5; i++) {
      store.add(makeEntry(`e${i}`, 'alice', i * 1000));
    }
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history').query({ pageSize: 2, page: 1 });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.hasNextPage).toBe(true);
  });

  it('paginates: last page reports hasNextPage false', async () => {
    const store = new InMemoryOrderHistoryStore();
    for (let i = 0; i < 5; i++) {
      store.add(makeEntry(`e${i}`, 'alice', i * 1000));
    }
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history').query({ pageSize: 2, page: 3 });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.hasNextPage).toBe(false);
  });

  it('rejects page=0 with 400', async () => {
    const store = new InMemoryOrderHistoryStore();
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history').query({ page: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page/);
  });

  it('rejects pageSize=-1 with 400', async () => {
    const store = new InMemoryOrderHistoryStore();
    const app = buildApp({ callerId: 'alice' }, store);

    const res = await request(app).get('/orders/history').query({ pageSize: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pageSize/);
  });
});
