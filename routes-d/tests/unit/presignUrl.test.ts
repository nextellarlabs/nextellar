/**
 * Unit tests for presignUrl.ts
 */

import {
  generatePresignUrl,
  validatePresignUrl,
  getPresignLogs,
  clearExpiredLogs,
  clearPresignLogs,
  type PresignOptions,
} from '../../lib/presignUrl.js';

describe('presignUrl', () => {
  beforeEach(() => {
    clearPresignLogs();
  });

  afterEach(() => {
    clearPresignLogs();
  });

  describe('generatePresignUrl', () => {
    it('generates a pre-signed URL with required parameters', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.method).toBe('PUT');
      expect(result.headers).toBeDefined();
    });

    it('includes content type in headers when provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        contentType: 'image/jpeg',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.headers['Content-Type']).toBe('image/jpeg');
    });

    it('uses custom TTL when provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        ttl: 1800, // 30 minutes
      };

      const result = generatePresignUrl(options, 'user1');

      const ttl = (result.expiresAt.getTime() - Date.now()) / 1000;
      expect(ttl).toBeGreaterThan(1700);
      expect(ttl).toBeLessThan(1900);
    });

    it('uses default TTL when not provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      const result = generatePresignUrl(options, 'user1');

      const ttl = (result.expiresAt.getTime() - Date.now()) / 1000;
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThan(3700);
    });

    it('supports different HTTP methods', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        method: 'POST',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.method).toBe('POST');
    });

    it('throws error for invalid TTL (too low)', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        ttl: 0,
      };

      expect(() => generatePresignUrl(options, 'user1')).toThrow('TTL must be between 1 and 86400');
    });

    it('throws error for invalid TTL (too high)', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        ttl: 86401,
      };

      expect(() => generatePresignUrl(options, 'user1')).toThrow('TTL must be between 1 and 86400');
    });

    it('throws error for invalid content type', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        contentType: 'invalid/type',
      };

      expect(() => generatePresignUrl(options, 'user1')).toThrow('Invalid content type');
    });

    it('accepts valid content types', () => {
      const validTypes = [
        'image/jpeg',
        'image/png',
        'application/pdf',
        'video/mp4',
      ];

      for (const contentType of validTypes) {
        const options: PresignOptions = {
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          contentType,
        };

        expect(() => generatePresignUrl(options, 'user1')).not.toThrow();
      }
    });

    it('logs issuance with user ID', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      generatePresignUrl(options, 'user1');

      const logs = getPresignLogs('user1');
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe('user1');
      expect(logs[0].bucket).toBe('test-bucket');
      expect(logs[0].key).toBe('test-file.jpg');
    });
  });

  describe('validatePresignUrl', () => {
    it('validates a correctly generated presigned URL', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      const result = generatePresignUrl(options, 'user1');
      const isValid = validatePresignUrl(result.url);

      expect(isValid).toBe(true);
    });

    it('rejects expired presigned URL', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        ttl: 1, // 1 second
      };

      const result = generatePresignUrl(options, 'user1');

      // Wait for expiration
      return new Promise((resolve) => {
        setTimeout(() => {
          const isValid = validatePresignUrl(result.url);
          expect(isValid).toBe(false);
          resolve(null);
        }, 1100);
      });
    });

    it('rejects URL without signature', () => {
      const url = 'https://storage.example.com/test-bucket/test-file.jpg';
      const isValid = validatePresignUrl(url);

      expect(isValid).toBe(false);
    });

    it('rejects URL without expiration', () => {
      const url = 'https://storage.example.com/test-bucket/test-file.jpg?signature=abc123';
      const isValid = validatePresignUrl(url);

      expect(isValid).toBe(false);
    });

    it('rejects URL with invalid signature', () => {
      const url = 'https://storage.example.com/test-bucket/test-file.jpg?signature=invalid&expires=9999999999999';
      const isValid = validatePresignUrl(url);

      expect(isValid).toBe(false);
    });

    it('handles malformed URL gracefully', () => {
      const url = 'not-a-valid-url';
      const isValid = validatePresignUrl(url);

      expect(isValid).toBe(false);
    });
  });

  describe('getPresignLogs', () => {
    it('returns empty array for user with no logs', () => {
      const logs = getPresignLogs('user1');
      expect(logs).toEqual([]);
    });

    it('returns logs for specific user', () => {
      generatePresignUrl({ bucket: 'bucket1', key: 'file1.jpg' }, 'user1');
      generatePresignUrl({ bucket: 'bucket2', key: 'file2.jpg' }, 'user2');

      const user1Logs = getPresignLogs('user1');
      const user2Logs = getPresignLogs('user2');

      expect(user1Logs).toHaveLength(1);
      expect(user2Logs).toHaveLength(1);
      expect(user1Logs[0].userId).toBe('user1');
      expect(user2Logs[0].userId).toBe('user2');
    });

    it('returns logs sorted by issuedAt descending', () => {
      generatePresignUrl({ bucket: 'bucket1', key: 'file1.jpg' }, 'user1');
      
      // Small delay to ensure different timestamps
      return new Promise((resolve) => {
        setTimeout(() => {
          generatePresignUrl({ bucket: 'bucket2', key: 'file2.jpg' }, 'user1');
          
          const logs = getPresignLogs('user1');
          expect(logs).toHaveLength(2);
          expect(logs[0].issuedAt.getTime()).toBeGreaterThan(logs[1].issuedAt.getTime());
          resolve(null);
        }, 10);
      });
    });

    it('includes content type in logs when provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        contentType: 'image/jpeg',
      };

      generatePresignUrl(options, 'user1');

      const logs = getPresignLogs('user1');
      expect(logs[0].contentType).toBe('image/jpeg');
    });
  });

  describe('clearExpiredLogs', () => {
    it('removes expired log entries', () => {
      generatePresignUrl({ bucket: 'bucket1', key: 'file1.jpg', ttl: 1 }, 'user1');
      
      return new Promise((resolve) => {
        setTimeout(() => {
          clearExpiredLogs();
          
          const logs = getPresignLogs('user1');
          expect(logs).toHaveLength(0);
          resolve(null);
        }, 1100);
      });
    });

    it('keeps non-expired log entries', () => {
      generatePresignUrl({ bucket: 'bucket1', key: 'file1.jpg', ttl: 3600 }, 'user1');
      
      clearExpiredLogs();
      
      const logs = getPresignLogs('user1');
      expect(logs).toHaveLength(1);
    });

    it('handles empty log gracefully', () => {
      expect(() => clearExpiredLogs()).not.toThrow();
    });
  });

  describe('clearPresignLogs', () => {
    it('clears all log entries', () => {
      generatePresignUrl({ bucket: 'bucket1', key: 'file1.jpg' }, 'user1');
      generatePresignUrl({ bucket: 'bucket2', key: 'file2.jpg' }, 'user2');

      expect(getPresignLogs('user1')).toHaveLength(1);
      expect(getPresignLogs('user2')).toHaveLength(1);

      clearPresignLogs();

      expect(getPresignLogs('user1')).toHaveLength(0);
      expect(getPresignLogs('user2')).toHaveLength(0);
    });
  });

  describe('Content type validation', () => {
    it('accepts common image types', () => {
      const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

      for (const contentType of imageTypes) {
        const options: PresignOptions = {
          bucket: 'test-bucket',
          key: 'test-file.jpg',
          contentType,
        };

        expect(() => generatePresignUrl(options, 'user1')).not.toThrow();
      }
    });

    it('accepts document types', () => {
      const docTypes = ['application/pdf', 'application/zip', 'text/plain', 'text/csv'];

      for (const contentType of docTypes) {
        const options: PresignOptions = {
          bucket: 'test-bucket',
          key: 'test-file.pdf',
          contentType,
        };

        expect(() => generatePresignUrl(options, 'user1')).not.toThrow();
      }
    });

    it('accepts media types', () => {
      const mediaTypes = ['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav'];

      for (const contentType of mediaTypes) {
        const options: PresignOptions = {
          bucket: 'test-bucket',
          key: 'test-file.mp4',
          contentType,
        };

        expect(() => generatePresignUrl(options, 'user1')).not.toThrow();
      }
    });

    it('is case-insensitive for content type validation', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        contentType: 'IMAGE/JPEG',
      };

      expect(() => generatePresignUrl(options, 'user1')).not.toThrow();
    });
  });

  describe('URL construction', () => {
    it('includes signature in URL', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toContain('signature=');
    });

    it('includes expiration in URL', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toContain('expires=');
    });

    it('includes method in URL', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        method: 'POST',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toContain('method=POST');
    });

    it('includes content type in URL when provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        contentType: 'image/jpeg',
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toContain('contentType=image/jpeg');
    });

    it('includes max size in URL when provided', () => {
      const options: PresignOptions = {
        bucket: 'test-bucket',
        key: 'test-file.jpg',
        maxSize: 10485760, // 10MB
      };

      const result = generatePresignUrl(options, 'user1');

      expect(result.url).toContain('maxSize=10485760');
    });
  });
});
