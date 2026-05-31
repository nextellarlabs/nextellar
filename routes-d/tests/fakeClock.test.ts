// Unit tests for fake clock helper (Issue #311).

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createFakeClock, createTestToken, type FakeClock } from './helpers/fakeClock.js';

describe('Fake Clock', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = createFakeClock(1000000);
  });

  afterEach(() => {
    clock.restore();
  });

  describe('now', () => {
    it('returns current fake time', () => {
      expect(clock.now()).toBe(1000000);
    });
  });

  describe('advance', () => {
    it('advances time by milliseconds', () => {
      clock.advance(1000);
      expect(clock.now()).toBe(1001000);

      clock.advance(500);
      expect(clock.now()).toBe(1001500);
    });

    it('supports negative advances', () => {
      clock.advance(-500);
      expect(clock.now()).toBe(999500);
    });
  });

  describe('setTime', () => {
    it('sets time to specific value', () => {
      clock.setTime(2000000);
      expect(clock.now()).toBe(2000000);
    });
  });

  describe('reset', () => {
    it('resets to initial time', () => {
      clock.advance(5000);
      expect(clock.now()).toBe(1005000);

      clock.reset();
      expect(clock.now()).toBe(1000000);
    });
  });

  describe('install and restore', () => {
    it('replaces global Date', () => {
      clock.install();

      const date = new Date();
      expect(date.getTime()).toBe(1000000);

      clock.advance(1000);
      const date2 = new Date();
      expect(date2.getTime()).toBe(1001000);

      clock.restore();
    });

    it('replaces Date.now()', () => {
      clock.install();

      expect(Date.now()).toBe(1000000);

      clock.advance(1000);
      expect(Date.now()).toBe(1001000);

      clock.restore();
    });

    it('replaces performance.now()', () => {
      clock.install();

      expect(performance.now()).toBe(1000000);

      clock.advance(1000);
      expect(performance.now()).toBe(1001000);

      clock.restore();
    });

    it('restores original implementations', () => {
      const originalNow = Date.now;
      const originalPerformanceNow = performance.now;

      clock.install();
      clock.restore();

      expect(Date.now).toBe(originalNow);
      expect(performance.now).toBe(originalPerformanceNow);
    });

    it('handles Date constructor with arguments', () => {
      clock.install();

      // Date with specific timestamp should use provided value
      const date = new Date(2000000);
      expect(date.getTime()).toBe(2000000);

      // Date with no args should use fake time
      const date2 = new Date();
      expect(date2.getTime()).toBe(1000000);

      clock.restore();
    });
  });

  describe('multiple clocks', () => {
    it('supports multiple independent clocks', () => {
      const clock1 = createFakeClock(1000000);
      const clock2 = createFakeClock(2000000);

      expect(clock1.now()).toBe(1000000);
      expect(clock2.now()).toBe(2000000);

      clock1.advance(1000);
      expect(clock1.now()).toBe(1001000);
      expect(clock2.now()).toBe(2000000);
    });
  });
});

describe('Test Token', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = createFakeClock(1000000);
    clock.install();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('createTestToken', () => {
    it('creates token with correct payload', () => {
      const token = createTestToken({
        sub: 'user-123',
        scopes: ['transfer:write'],
        expiresIn: 3600,
      }, clock);

      expect(token.payload.sub).toBe('user-123');
      expect(token.payload.scopes).toEqual(['transfer:write']);
      expect(token.payload.iat).toBe(Math.floor(1000000 / 1000));
      expect(token.payload.exp).toBe(Math.floor((1000000 + 3600000) / 1000));
    });

    it('uses default expiry of 1 hour', () => {
      const token = createTestToken({ sub: 'user-123' }, clock);

      expect(token.payload.exp - token.payload.iat).toBe(3600);
    });

    it('supports custom issuedAt time', () => {
      const token = createTestToken({
        sub: 'user-123',
        issuedAt: 500000,
        expiresIn: 3600,
      }, clock);

      expect(token.payload.iat).toBe(Math.floor(500000 / 1000));
      expect(token.payload.exp).toBe(Math.floor((500000 + 3600000) / 1000));
    });

    it('calculates expiresAt correctly', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      expect(token.expiresAt).toBe(1000000 + 3600000);
    });
  });

  describe('isExpired', () => {
    it('returns false for valid tokens', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      expect(token.isExpired()).toBe(false);
    });

    it('returns true for expired tokens', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      clock.advance(3600000);
      expect(token.isExpired()).toBe(true);
    });

    it('returns true at exact expiry time', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      clock.advance(3600000);
      expect(token.isExpired()).toBe(true);
    });

    it('returns false just before expiry', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      clock.advance(3599999);
      expect(token.isExpired()).toBe(false);
    });

    it('supports custom time parameter', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      expect(token.isExpired(1000000)).toBe(false);
      expect(token.isExpired(1000000 + 3600000)).toBe(true);
    });
  });

  describe('token lifecycle', () => {
    it('simulates complete token lifecycle', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 3600,
      }, clock);

      // Token is valid immediately
      expect(token.isExpired()).toBe(false);

      // Token is valid after 30 minutes
      clock.advance(1800000);
      expect(token.isExpired()).toBe(false);

      // Token is valid at 59 minutes 59 seconds
      clock.advance(1799999);
      expect(token.isExpired()).toBe(false);

      // Token is expired at 1 hour
      clock.advance(1);
      expect(token.isExpired()).toBe(true);
    });

    it('handles multiple tokens with different expiries', () => {
      const token1 = createTestToken({
        sub: 'user-1',
        expiresIn: 1800, // 30 minutes
      }, clock);

      const token2 = createTestToken({
        sub: 'user-2',
        expiresIn: 3600, // 1 hour
      }, clock);

      clock.advance(1800000); // 30 minutes
      expect(token1.isExpired()).toBe(true);
      expect(token2.isExpired()).toBe(false);

      clock.advance(1800000); // 1 hour total
      expect(token1.isExpired()).toBe(true);
      expect(token2.isExpired()).toBe(true);
    });
  });

  describe('no sleep required', () => {
    it('tests token expiry without sleep', () => {
      const token = createTestToken({
        sub: 'user-123',
        expiresIn: 1, // 1 second
      }, clock);

      expect(token.isExpired()).toBe(false);

      // Advance 1.1 seconds instantly (no sleep)
      clock.advance(1100);
      expect(token.isExpired()).toBe(true);

      // This test completes instantly, not after 1.1 seconds
    });

    it('tests multiple expiry scenarios instantly', () => {
      const scenarios = [
        { expiresIn: 60, advanceMs: 30000, shouldExpire: false },
        { expiresIn: 60, advanceMs: 60000, shouldExpire: true },
        { expiresIn: 3600, advanceMs: 1800000, shouldExpire: false },
        { expiresIn: 3600, advanceMs: 3600000, shouldExpire: true },
      ];

      for (const scenario of scenarios) {
        clock.reset();
        const token = createTestToken({
          sub: 'user-123',
          expiresIn: scenario.expiresIn,
        }, clock);

        clock.advance(scenario.advanceMs);
        expect(token.isExpired()).toBe(scenario.shouldExpire);
      }

      // All scenarios tested instantly
    });
  });
});
