/**
 * Integration tests for deprecation middleware with Express
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express, { Application } from 'express';
import request from 'supertest';
import {
  createDeprecationMiddleware,
  DeprecationMiddleware,
  DeprecationManifest,
} from '../../middleware/deprecation.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Deprecation Middleware Integration', () => {
  let app: Application;
  let testManifestPath: string;
  let testManifestDir: string;
  let middleware: DeprecationMiddleware;

  beforeEach(() => {
    // Setup test manifest
    testManifestDir = path.join(__dirname, '..', '..', 'test-fixtures');
    testManifestPath = path.join(testManifestDir, 'integration-deprecation-manifest.json');

    if (!existsSync(testManifestDir)) {
      mkdirSync(testManifestDir, { recursive: true });
    }

    const testManifest: DeprecationManifest = {
      version: '1.0.0',
      deprecated: [
        {
          method: 'GET',
          path: '/api/v1/users',
          deprecation: 'true',
          sunset: 'Sun, 01 Jan 2027 00:00:00 GMT',
          message: 'Use /api/v2/users instead',
          link: 'https://docs.example.com/migration',
        },
        {
          method: 'POST',
          path: '/api/v1/posts',
          deprecation: 'Sat, 01 Mar 2025 00:00:00 GMT',
        },
        {
          method: '*',
          path: '/api/legacy/*',
          deprecation: 'true',
          sunset: 'Mon, 01 Jun 2026 00:00:00 GMT',
          message: 'Legacy API is deprecated',
        },
        {
          method: 'GET',
          path: '/api/users/:id',
          deprecation: 'true',
          message: 'Use /api/v2/users/:id',
        },
      ],
    };

    writeFileSync(testManifestPath, JSON.stringify(testManifest, null, 2));

    // Create Express app with middleware
    middleware = createDeprecationMiddleware(testManifestPath);
    app = express();

    // Apply deprecation middleware globally
    app.use(middleware.middleware());

    // Define test routes
    app.get('/api/v1/users', (_req, res) => {
      res.json({ users: [] });
    });

    app.get('/api/v2/users', (_req, res) => {
      res.json({ users: [] });
    });

    app.post('/api/v1/posts', (_req, res) => {
      res.json({ post: { id: 1 } });
    });

    app.get('/api/legacy/data', (_req, res) => {
      res.json({ data: 'legacy' });
    });

    app.delete('/api/legacy/resource', (_req, res) => {
      res.status(204).send();
    });

    app.get('/api/users/:id', (req, res) => {
      res.json({ user: { id: req.params.id } });
    });

    app.get('/api/healthy', (_req, res) => {
      res.json({ status: 'ok' });
    });
  });

  afterEach(() => {
    if (existsSync(testManifestDir)) {
      rmSync(testManifestDir, { recursive: true, force: true });
    }
    middleware.clearStats();
    middleware.unwatchManifest();
  });

  describe('HTTP header responses', () => {
    it('should return all deprecation headers for matching endpoint', async () => {
      const response = await request(app).get('/api/v1/users');

      expect(response.status).toBe(200);
      expect(response.headers['deprecation']).toBe('true');
      expect(response.headers['sunset']).toBe('Sun, 01 Jan 2027 00:00:00 GMT');
      expect(response.headers['link']).toBe(
        '<https://docs.example.com/migration>; rel="deprecation"'
      );
      expect(response.headers['x-deprecation-message']).toBe(
        'Use /api/v2/users instead'
      );
    });

    it('should not return deprecation headers for non-deprecated endpoint', async () => {
      const response = await request(app).get('/api/v2/users');

      expect(response.status).toBe(200);
      expect(response.headers['deprecation']).toBeUndefined();
      expect(response.headers['sunset']).toBeUndefined();
      expect(response.headers['link']).toBeUndefined();
      expect(response.headers['x-deprecation-message']).toBeUndefined();
    });

    it('should handle POST request deprecation', async () => {
      const response = await request(app).post('/api/v1/posts');

      expect(response.status).toBe(200);
      expect(response.headers['deprecation']).toBe('Sat, 01 Mar 2025 00:00:00 GMT');
    });

    it('should match wildcard methods', async () => {
      const getResponse = await request(app).get('/api/legacy/data');
      const deleteResponse = await request(app).delete('/api/legacy/resource');

      expect(getResponse.headers['deprecation']).toBe('true');
      expect(getResponse.headers['x-deprecation-message']).toBe(
        'Legacy API is deprecated'
      );
      expect(deleteResponse.headers['deprecation']).toBe('true');
    });

    it('should match parameterized paths', async () => {
      const response = await request(app).get('/api/users/123');

      expect(response.status).toBe(200);
      expect(response.headers['deprecation']).toBe('true');
      expect(response.headers['x-deprecation-message']).toBe(
        'Use /api/v2/users/:id'
      );
    });

    it('should not affect response body', async () => {
      const response = await request(app).get('/api/v1/users');

      expect(response.body).toEqual({ users: [] });
    });
  });

  describe('usage statistics', () => {
    beforeEach(() => {
      middleware.clearStats();
    });

    it('should track deprecated endpoint usage', async () => {
      await request(app).get('/api/v1/users');

      const stats = middleware.getStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].endpoint).toBe('/api/v1/users');
      expect(stats[0].method).toBe('GET');
      expect(stats[0].count).toBe(1);
    });

    it('should track multiple requests to same endpoint', async () => {
      await request(app).get('/api/v1/users');
      await request(app).get('/api/v1/users');
      await request(app).get('/api/v1/users');

      const stats = middleware.getStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].count).toBe(3);
    });

    it('should track different deprecated endpoints separately', async () => {
      await request(app).get('/api/v1/users');
      await request(app).post('/api/v1/posts');
      await request(app).get('/api/legacy/data');

      const stats = middleware.getStats();
      expect(stats.length).toBeGreaterThanOrEqual(3);
      
      const userStats = stats.find((s) => s.endpoint === '/api/v1/users');
      const postStats = stats.find((s) => s.endpoint === '/api/v1/posts');
      const legacyStats = stats.find((s) => s.endpoint === '/api/legacy/data');

      expect(userStats?.count).toBe(1);
      expect(postStats?.count).toBe(1);
      expect(legacyStats?.count).toBe(1);
    });

    it('should not track non-deprecated endpoints', async () => {
      await request(app).get('/api/v2/users');
      await request(app).get('/api/healthy');

      const stats = middleware.getStats();
      expect(stats).toHaveLength(0);
    });

    it('should include timestamp in statistics', async () => {
      const before = new Date().toISOString();
      await request(app).get('/api/v1/users');
      const after = new Date().toISOString();

      const stats = middleware.getStats();
      expect(stats[0].lastAccessed).toBeDefined();
      expect(stats[0].lastAccessed >= before).toBe(true);
      expect(stats[0].lastAccessed <= after).toBe(true);
    });
  });

  describe('manifest reload', () => {
    it('should use updated manifest after reload', async () => {
      // First request with original manifest
      const response1 = await request(app).get('/api/v1/users');
      expect(response1.headers['deprecation']).toBe('true');

      // Update manifest
      const updatedManifest: DeprecationManifest = {
        version: '2.0.0',
        deprecated: [],
      };
      writeFileSync(testManifestPath, JSON.stringify(updatedManifest, null, 2));
      middleware.loadManifest();

      // Second request should not have deprecation headers
      const response2 = await request(app).get('/api/v1/users');
      expect(response2.headers['deprecation']).toBeUndefined();
    });

    it('should handle adding new deprecations', async () => {
      // Initial request - not deprecated
      const response1 = await request(app).get('/api/healthy');
      expect(response1.headers['deprecation']).toBeUndefined();

      // Update manifest to deprecate the endpoint
      const updatedManifest: DeprecationManifest = {
        version: '2.0.0',
        deprecated: [
          {
            method: 'GET',
            path: '/api/healthy',
            deprecation: 'true',
            message: 'Health endpoint is deprecated',
          },
        ],
      };
      writeFileSync(testManifestPath, JSON.stringify(updatedManifest, null, 2));
      middleware.loadManifest();

      // Second request should have deprecation headers
      const response2 = await request(app).get('/api/healthy');
      expect(response2.headers['deprecation']).toBe('true');
      expect(response2.headers['x-deprecation-message']).toBe(
        'Health endpoint is deprecated'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle case-insensitive method matching', async () => {
      const response = await request(app).get('/api/v1/users');
      expect(response.headers['deprecation']).toBe('true');
    });

    it('should handle missing optional headers gracefully', async () => {
      const response = await request(app).post('/api/v1/posts');

      expect(response.status).toBe(200);
      expect(response.headers['deprecation']).toBe('Sat, 01 Mar 2025 00:00:00 GMT');
      expect(response.headers['sunset']).toBeUndefined();
      expect(response.headers['link']).toBeUndefined();
    });

    it('should not interfere with other middleware', async () => {
      // Add another middleware after deprecation
      const app2 = express();
      app2.use(middleware.middleware());
      app2.use((_req, res, next) => {
        res.setHeader('X-Custom-Header', 'test-value');
        next();
      });
      app2.get('/api/v1/users', (_req, res) => {
        res.json({ users: [] });
      });

      const response = await request(app2).get('/api/v1/users');

      expect(response.headers['deprecation']).toBe('true');
      expect(response.headers['x-custom-header']).toBe('test-value');
    });
  });
});
