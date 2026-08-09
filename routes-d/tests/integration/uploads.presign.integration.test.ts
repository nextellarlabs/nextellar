/**
 * Integration tests for uploads presign endpoint
 */

import request from 'supertest';
import express from 'express';
import uploadsPresignRouter from '../../routes/uploads.presign.js';
import { clearPresignLogs } from '../../lib/presignUrl.js';

describe('Uploads Presign Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    clearPresignLogs();

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      // Mock authentication middleware
      (req as any).user = { sub: 'user1' };
      next();
    });
    app.use(uploadsPresignRouter);
  });

  describe('POST /uploads/presign', () => {
    it('returns 200 for successful presign URL generation', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('url');
      expect(response.body.data).toHaveProperty('expiresAt');
      expect(response.body.data).toHaveProperty('method');
      expect(response.body.data).toHaveProperty('headers');
    });

    it('generates presign URL with content type', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.headers['Content-Type']).toBe('image/jpeg');
    });

    it('generates presign URL with custom TTL', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 1800,
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('expiresAt');
    });

    it('generates presign URL with custom method', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          method: 'POST',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.method).toBe('POST');
    });

    it('generates presign URL with max size', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          maxSize: 10485760,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.url).toContain('maxSize=');
    });

    it('returns 400 for missing bucket', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          key: 'test-file.jpg',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('bucket');
    });

    it('returns 400 for missing key', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('key');
    });

    it('returns 400 for invalid bucket format', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'invalid/bucket',
          key: 'test-file.jpg',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('bucket');
    });

    it('returns 400 for key starting with slash', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: '/test-file.jpg',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('key');
    });

    it('returns 400 for key too long', async () => {
      const longKey = 'a'.repeat(1025);
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: longKey,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('key');
    });

    it('returns 400 for invalid TTL (zero)', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('ttl');
    });

    it('returns 400 for invalid TTL (too high)', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 86401,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('ttl');
    });

    it('returns 400 for invalid content type', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          contentType: 'invalid/type',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('content type');
    });

    it('returns 400 for invalid method', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          method: 'DELETE',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('method');
    });

    it('returns 400 for invalid max size (zero)', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          maxSize: 0,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('maxSize');
    });

    it('returns 400 for invalid max size (too high)', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          maxSize: 10737418241,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('maxSize');
    });

    it('logs issuance with user ID', async () => {
      await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
        });

      const logsResponse = await request(app)
        .get('/uploads/presign/logs');

      expect(logsResponse.status).toBe(200);
      expect(logsResponse.body.data).toHaveLength(1);
      expect(logsResponse.body.data[0].userId).toBe('user1');
      expect(logsResponse.body.data[0].bucket).toBe('test-bucket');
      expect(logsResponse.body.data[0].key).toBe('test-file.jpg');
    });
  });

  describe('POST /uploads/presign/validate', () => {
    it('validates a correctly generated presigned URL', async () => {
      const presignResponse = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
        });

      const validateResponse = await request(app)
        .post('/uploads/presign/validate')
        .send({
          url: presignResponse.body.data.url,
        });

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body.data.valid).toBe(true);
    });

    it('rejects invalid URL', async () => {
      const response = await request(app)
        .post('/uploads/presign/validate')
        .send({
          url: 'https://invalid-url.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.valid).toBe(false);
    });

    it('returns 400 for missing URL', async () => {
      const response = await request(app)
        .post('/uploads/presign/validate')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('url');
    });

    it('returns 400 for empty URL', async () => {
      const response = await request(app)
        .post('/uploads/presign/validate')
        .send({
          url: '',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('url');
    });
  });

  describe('GET /uploads/presign/logs', () => {
    it('returns logs for authenticated user', async () => {
      await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
        });

      const response = await request(app)
        .get('/uploads/presign/logs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/uploads/presign')
          .send({
            bucket: 'test-bucket',
            key: `test-file-${i}.jpg`,
          });
      }

      const response = await request(app)
        .get('/uploads/presign/logs?limit=3');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(3);
    });

    it('returns 400 for invalid limit (too low)', async () => {
      const response = await request(app)
        .get('/uploads/presign/logs?limit=0');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });

    it('returns 400 for invalid limit (too high)', async () => {
      const response = await request(app)
        .get('/uploads/presign/logs?limit=101');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });

    it('returns empty array for user with no logs', async () => {
      clearPresignLogs();

      const response = await request(app)
        .get('/uploads/presign/logs');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('clears expired logs automatically', async () => {
      await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 1,
        });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const response = await request(app)
        .get('/uploads/presign/logs');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('POST /uploads/presign/clear-logs', () => {
    it('clears all presign logs', async () => {
      await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
        });

      let logsResponse = await request(app)
        .get('/uploads/presign/logs');
      expect(logsResponse.body.data).toHaveLength(1);

      await request(app)
        .post('/uploads/presign/clear-logs');

      logsResponse = await request(app)
        .get('/uploads/presign/logs');
      expect(logsResponse.body.data).toHaveLength(0);
    });

    it('returns success message after clearing logs', async () => {
      const response = await request(app)
        .post('/uploads/presign/clear-logs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('cleared');
    });
  });

  describe('Content type restrictions', () => {
    it('accepts valid image content types', async () => {
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

      for (const contentType of validTypes) {
        const response = await request(app)
          .post('/uploads/presign')
          .send({
            bucket: 'test-bucket',
            key: 'test-file.jpg',
            contentType,
          });

        expect(response.status).toBe(200);
      }
    });

    it('accepts valid document content types', async () => {
      const validTypes = ['application/pdf', 'application/zip', 'text/plain', 'text/csv'];

      for (const contentType of validTypes) {
        const response = await request(app)
          .post('/uploads/presign')
          .send({
            bucket: 'test-bucket',
            key: 'test-file.pdf',
            contentType,
          });

        expect(response.status).toBe(200);
      }
    });

    it('rejects disallowed content types', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.exe',
          contentType: 'application/x-msdownload',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('content type');
    });
  });

  describe('URL expiration', () => {
    it('generates URL with expiration in the future', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 3600,
        });

      expect(response.status).toBe(200);
      const expiresAt = new Date(response.body.data.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('generates URL with correct TTL', async () => {
      const response = await request(app)
        .post('/uploads/presign')
        .send({
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          ttl: 1800,
        });

      expect(response.status).toBe(200);
      const expiresAt = new Date(response.body.data.expiresAt);
      const ttl = (expiresAt.getTime() - Date.now()) / 1000;
      expect(ttl).toBeGreaterThan(1700);
      expect(ttl).toBeLessThan(1900);
    });
  });

  describe('Multiple requests', () => {
    it('handles multiple presign requests', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/uploads/presign')
            .send({
              bucket: 'test-bucket',
              key: `test-file-${i}.jpg`,
            })
        );
      }

      const responses = await Promise.all(promises);

      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.data).toHaveProperty('url');
      }
    });

    it('logs all requests', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/uploads/presign')
          .send({
            bucket: 'test-bucket',
            key: `test-file-${i}.jpg`,
          });
      }

      const logsResponse = await request(app)
        .get('/uploads/presign/logs');

      expect(logsResponse.status).toBe(200);
      expect(logsResponse.body.data).toHaveLength(5);
    });
  });
});
