/**
 * Integration tests for orders full-text search endpoint
 */

import request from 'supertest';
import express from 'express';
import ordersFtsRouter from '../../routes/orders.fts.js';
import { orders, orderFTSIndex } from '../../routes/orders.fts.js';

describe('Orders Full-Text Search Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    // Clear orders and FTS index
    orders.clear();
    orderFTSIndex.clear();

    // Add sample orders
    const now = new Date();
    orders.set('order1', {
      id: 'order1',
      customerId: 'user1',
      status: 'completed',
      amount: 100,
      currency: 'USD',
      description: 'Software development services',
      customerName: 'John Doe',
      customerEmail: 'john@example.com',
      shippingAddress: '123 Main St, City',
      items: 'Consulting hours, code review',
      notes: 'Priority project',
      createdAt: new Date(now.getTime() - 86400000),
      updatedAt: now,
    });

    orders.set('order2', {
      id: 'order2',
      customerId: 'user1',
      status: 'pending',
      amount: 250,
      currency: 'USD',
      description: 'Web design package',
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      shippingAddress: '456 Oak Ave, Town',
      items: 'UI design, UX research',
      notes: 'Rush delivery',
      createdAt: new Date(now.getTime() - 43200000),
      updatedAt: now,
    });

    orders.set('order3', {
      id: 'order3',
      customerId: 'user2',
      status: 'processing',
      amount: 75,
      currency: 'USD',
      description: 'Mobile app testing',
      customerName: 'Bob Johnson',
      customerEmail: 'bob@example.com',
      shippingAddress: '789 Pine Rd, Village',
      items: 'QA testing, bug fixes',
      createdAt: new Date(now.getTime() - 172800000),
      updatedAt: now,
    });

    // Initialize FTS index
    const ordersArray = Array.from(orders.values());
    for (const order of ordersArray) {
      const document = {
        id: order.id,
        fields: {
          description: order.description,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          shippingAddress: order.shippingAddress,
          items: order.items,
          notes: order.notes || '',
          status: order.status,
        },
      };
      orderFTSIndex.addDocument(document);
    }

    // Setup express app
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      // Mock authentication middleware
      (req as any).user = { sub: 'user1' };
      next();
    });
    app.use(ordersFtsRouter);
  });

  describe('POST /orders/search', () => {
    it('returns 200 for successful search', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'software development' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('finds orders by description', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'software' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('order1');
      expect(response.body.data[0].description).toContain('software');
    });

    it('finds orders by customer name', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'John Doe' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].customerName).toBe('John Doe');
    });

    it('finds orders by items', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'consulting' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].items).toContain('consulting');
    });

    it('finds orders by notes', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'priority' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].notes).toContain('priority');
    });

    it('returns empty array for no matches', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'nonexistent term xyz' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('respects limit parameter', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'services design testing', limit: '2' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(2);
    });

    it('respects minScore parameter', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'services', minScore: '10.0' });

      expect(response.status).toBe(200);
      // Should filter out low-score results
      expect(response.body.data.every((r: any) => r.score >= 10.0)).toBe(true);
    });

    it('returns 400 for missing query parameter', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Query parameter');
    });

    it('returns 400 for invalid limit', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'test', limit: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });

    it('returns 400 for invalid minScore', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'test', minScore: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('minScore');
    });

    it('filters results by customer ID', async () => {
      // Search for orders that exist but belong to different user
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'Bob Johnson' });

      // Should not return order3 since it belongs to user2
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });

    it('includes relevance score in results', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'software' });

      expect(response.status).toBe(200);
      if (response.body.data.length > 0) {
        expect(response.body.data[0]).toHaveProperty('score');
        expect(typeof response.body.data[0].score).toBe('number');
        expect(response.body.data[0].score).toBeGreaterThan(0);
      }
    });

    it('includes matched fields in results', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'software development' });

      expect(response.status).toBe(200);
      if (response.body.data.length > 0) {
        expect(response.body.data[0]).toHaveProperty('matchedFields');
        expect(Array.isArray(response.body.data[0].matchedFields)).toBe(true);
      }
    });

    it('returns metadata about search', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'test', limit: '5', minScore: '0' });

      expect(response.status).toBe(200);
      expect(response.body.meta).toHaveProperty('query');
      expect(response.body.meta).toHaveProperty('totalResults');
      expect(response.body.meta).toHaveProperty('limit');
      expect(response.body.meta).toHaveProperty('minScore');
      expect(response.body.meta.query).toBe('test');
      expect(response.body.meta.limit).toBe(5);
    });
  });

  describe('GET /orders/fts/stats', () => {
    it('returns FTS index statistics', async () => {
      const response = await request(app)
        .get('/orders/fts/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('documentCount');
      expect(response.body.data).toHaveProperty('totalTokens');
      expect(response.body.data).toHaveProperty('uniqueTerms');
      expect(response.body.data).toHaveProperty('averageDocumentLength');
    });

    it('returns correct document count', async () => {
      const response = await request(app)
        .get('/orders/fts/stats');

      expect(response.status).toBe(200);
      expect(response.body.data.documentCount).toBe(3);
    });
  });

  describe('POST /orders/fts/reindex', () => {
    it('rebuilds the FTS index', async () => {
      const response = await request(app)
        .post('/orders/fts/reindex');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('rebuilt');
      expect(response.body.data).toHaveProperty('documentCount');
    });

    it('index is functional after reindex', async () => {
      // Reindex
      await request(app).post('/orders/fts/reindex');

      // Search should still work
      const searchResponse = await request(app)
        .post('/orders/search')
        .send({ q: 'software' });

      expect(searchResponse.status).toBe(200);
    });
  });

  describe('Search ranking', () => {
    it('ranks results by relevance score', async () => {
      // Add order with repeated terms for higher score
      orders.set('order4', {
        id: 'order4',
        customerId: 'user1',
        status: 'pending',
        amount: 50,
        currency: 'USD',
        description: 'software software software development',
        customerName: 'Test User',
        customerEmail: 'test@example.com',
        shippingAddress: 'Test Address',
        items: 'software services',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      orderFTSIndex.addDocument({
        id: 'order4',
        fields: {
          description: 'software software software development',
          customerName: 'Test User',
          customerEmail: 'test@example.com',
          shippingAddress: 'Test Address',
          items: 'software services',
          notes: '',
          status: 'pending',
        },
      });

      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'software' });

      expect(response.status).toBe(200);
      if (response.body.data.length > 1) {
        // order4 should rank higher due to term frequency
        const scores = response.body.data.map((r: any) => r.score);
        expect(scores[0]).toBeGreaterThanOrEqual(scores[scores.length - 1]);
      }
    });
  });

  describe('Multi-term search', () => {
    it('handles queries with multiple terms', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'web design' });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('matches terms across different fields', async () => {
      const response = await request(app)
        .post('/orders/search')
        .send({ q: 'john consulting' });

      expect(response.status).toBe(200);
      if (response.body.data.length > 0) {
        expect(response.body.data[0].matchedFields.length).toBeGreaterThan(0);
      }
    });
  });
});
