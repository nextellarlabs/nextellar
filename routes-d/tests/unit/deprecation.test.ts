/**
 * Unit tests for deprecation middleware
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
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

describe('DeprecationMiddleware', () => {
  let testManifestPath: string;
  let testManifestDir: string;
  let middleware: DeprecationMiddleware;

  const createMockRequest = (method: string, path: string): Partial<Request> => ({
    method,
    path,
    headers: {},
  });

  const createMockResponse = (): Partial<Response> => {
    const headers: Record<string, string> = {};
    return {
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }) as any,
      getHeader: jest.fn((name: string) => headers[name]) as any,
      _headers: headers,
    };
  };

  const createMockNext = (): NextFunction => jest.fn() as any;

  beforeEach(() => {
    // Create test manifest directory
    testManifestDir = path.join(__dirname, '..', '..', 'test-fixtures');
    testManifestPath = path.join(testManifestDir, 'test-deprecation-manifest.json');

    if (!existsSync(testManifestDir)) {
      mkdirSync(testManifestDir, { recursive: true });
    }

    // Create test manifest
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
          sunset: 'Mon, 01 Jun 2026 00:00:00 GMT',
        },
        {
          method: '*',
          path: '/api/legacy/*',
          deprecation: 'true',
          message: 'Legacy endpoints are deprecated',
        },
      ],
    };

    writeFileSync(testManifestPath, JSON.stringify(testManifest, null, 2));
    middleware = createDeprecationMiddleware(testManifestPath);
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testManifestDir)) {
      rmSync(testManifestDir, { recursive: true, force: true });
    }
    middleware.clearStats();
    middleware.unwatchManifest();
  });

  describe('manifest loading', () => {
    it('should load manifest successfully', () => {
      const manifest = middleware.getManifest();
      expect(manifest).not.toBeNull();
      expect(manifest?.version).toBe('1.0.0');
      expect(manifest?.deprecated).toHaveLength(3);
    });

    it('should handle missing manifest file', () => {
      const nonExistentPath = path.join(testManifestDir, 'does-not-exist.json');
      const mw = createDeprecationMiddleware(nonExistentPath);
      expect(mw.getManifest()).toBeNull();
    });

    it('should handle invalid JSON in manifest', () => {
      const invalidPath = path.join(testManifestDir, 'invalid.json');
      writeFileSync(invalidPath, 'not valid json{]');
      const mw = createDeprecationMiddleware(invalidPath);
      expect(mw.getManifest()).toBeNull();
    });

    it('should reload manifest when changed', (done) => {
      middleware.watchManifest();

      // Update manifest
      const updatedManifest: DeprecationManifest = {
        version: '2.0.0',
        deprecated: [],
      };

      setTimeout(() => {
        writeFileSync(testManifestPath, JSON.stringify(updatedManifest, null, 2));
      }, 100);

      // Check after reload
      setTimeout(() => {
        const manifest = middleware.getManifest();
        expect(manifest?.version).toBe('2.0.0');
        middleware.unwatchManifest();
        done();
      }, 3000);
    }, 10000);
  });

  describe('header emission', () => {
    it('should emit Deprecation header for exact match', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(next).toHaveBeenCalled();
    });

    it('should emit Sunset header when provided', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Sunset',
        'Sun, 01 Jan 2027 00:00:00 GMT'
      );
    });

    it('should emit Link header when provided', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Link',
        '<https://docs.example.com/migration>; rel="deprecation"'
      );
    });

    it('should emit custom message header when provided', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Deprecation-Message',
        'Use /api/v2/users instead'
      );
    });

    it('should not emit headers for non-deprecated endpoints', () => {
      const req = createMockRequest('GET', '/api/v2/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should match wildcard method', () => {
      const req = createMockRequest('DELETE', '/api/legacy/resource') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    });

    it('should match wildcard path', () => {
      const req = createMockRequest('GET', '/api/legacy/anything/here') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    });

    it('should handle specific method matching', () => {
      const req = createMockRequest('POST', '/api/v1/posts') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Deprecation',
        'Sat, 01 Mar 2025 00:00:00 GMT'
      );
    });

    it('should not match wrong method', () => {
      const req = createMockRequest('GET', '/api/v1/posts') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('usage logging', () => {
    beforeEach(() => {
      middleware.clearStats();
    });

    it('should log deprecated endpoint usage', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      const stats = middleware.getStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].endpoint).toBe('/api/v1/users');
      expect(stats[0].method).toBe('GET');
      expect(stats[0].count).toBe(1);
    });

    it('should increment count for repeated access', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);
      middleware.middleware()(req, res, next);
      middleware.middleware()(req, res, next);

      const stats = middleware.getStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].count).toBe(3);
    });

    it('should track multiple deprecated endpoints separately', () => {
      const req1 = createMockRequest('GET', '/api/v1/users') as Request;
      const req2 = createMockRequest('POST', '/api/v1/posts') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req1, res, next);
      middleware.middleware()(req2, res, next);

      const stats = middleware.getStats();
      expect(stats).toHaveLength(2);
      expect(stats.find((s) => s.endpoint === '/api/v1/users')).toBeDefined();
      expect(stats.find((s) => s.endpoint === '/api/v1/posts')).toBeDefined();
    });

    it('should update lastAccessed timestamp', (done) => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);
      const firstStats = middleware.getStats()[0];
      const firstTime = firstStats.lastAccessed;

      setTimeout(() => {
        middleware.middleware()(req, res, next);
        const secondStats = middleware.getStats()[0];
        const secondTime = secondStats.lastAccessed;

        expect(new Date(secondTime).getTime()).toBeGreaterThan(
          new Date(firstTime).getTime()
        );
        done();
      }, 10);
    });

    it('should not log non-deprecated endpoints', () => {
      const req = createMockRequest('GET', '/api/v2/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);

      const stats = middleware.getStats();
      expect(stats).toHaveLength(0);
    });

    it('should clear stats when requested', () => {
      const req = createMockRequest('GET', '/api/v1/users') as Request;
      const res = createMockResponse() as Response;
      const next = createMockNext();

      middleware.middleware()(req, res, next);
      expect(middleware.getStats()).toHaveLength(1);

      middleware.clearStats();
      expect(middleware.getStats()).toHaveLength(0);
    });
  });
});


