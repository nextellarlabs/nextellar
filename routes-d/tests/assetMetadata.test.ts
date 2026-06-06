// Unit tests for asset metadata cache (Issue #285).

import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import {
  createAssetMetadataCache,
  queryAssetMetadata,
  type AssetMetadata,
  type AssetMetadataCache,
} from '../lib/assetMetadata.js';

describe('Asset Metadata Cache', () => {
  let cache: AssetMetadataCache;

  beforeEach(() => {
    cache = createAssetMetadataCache({ ttlMs: 1000, maxSize: 10 });
  });

  describe('set and get', () => {
    it('stores and retrieves metadata', () => {
      const metadata: AssetMetadata = {
        code: 'USDC',
        issuer: 'GA5Z...',
        decimals: 6,
      };

      cache.set('USDC:GA5Z...', metadata);
      expect(cache.get('USDC:GA5Z...')).toEqual(metadata);
    });

    it('returns undefined for missing keys', () => {
      expect(cache.get('MISSING')).toBeUndefined();
    });

    it('returns undefined for expired entries', () => {
      const metadata: AssetMetadata = {
        code: 'USDC',
        issuer: 'GA5Z...',
      };

      cache.set('USDC:GA5Z...', metadata);
      expect(cache.get('USDC:GA5Z...')).toBeDefined();

      // Simulate expiry by advancing time
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      expect(cache.get('USDC:GA5Z...')).toBeUndefined();
      vi.useRealTimers();
    });
  });

  describe('has', () => {
    it('returns true for cached entries', () => {
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      expect(cache.has('USDC:GA5Z...')).toBe(true);
    });

    it('returns false for missing entries', () => {
      expect(cache.has('MISSING')).toBe(false);
    });

    it('returns false for expired entries', () => {
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);
      expect(cache.has('USDC:GA5Z...')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('isStale', () => {
    it('returns false for fresh entries', () => {
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      expect(cache.isStale('USDC:GA5Z...')).toBe(false);
    });

    it('returns true for stale entries (within refresh window)', () => {
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      vi.useFakeTimers();
      // Advance to 80% of TTL (refresh window)
      vi.advanceTimersByTime(800);
      expect(cache.isStale('USDC:GA5Z...')).toBe(true);
      vi.useRealTimers();
    });

    it('returns true for missing entries', () => {
      expect(cache.isStale('MISSING')).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      cache.set('EURC:GA5Z...', { code: 'EURC', issuer: 'GA5Z...' });
      expect(cache.size()).toBe(2);

      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.get('USDC:GA5Z...')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('returns number of cached entries', () => {
      expect(cache.size()).toBe(0);
      cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...' });
      expect(cache.size()).toBe(1);
      cache.set('EURC:GA5Z...', { code: 'EURC', issuer: 'GA5Z...' });
      expect(cache.size()).toBe(2);
    });
  });

  describe('maxSize eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      const smallCache = createAssetMetadataCache({ maxSize: 2 });

      smallCache.set('KEY1', { code: 'A', issuer: 'A' });
      smallCache.set('KEY2', { code: 'B', issuer: 'B' });
      expect(smallCache.size()).toBe(2);

      // Adding third entry should evict first
      smallCache.set('KEY3', { code: 'C', issuer: 'C' });
      expect(smallCache.size()).toBe(2);
      expect(smallCache.has('KEY1')).toBe(false);
      expect(smallCache.has('KEY2')).toBe(true);
      expect(smallCache.has('KEY3')).toBe(true);
    });

    it('does not evict when updating existing key', () => {
      const smallCache = createAssetMetadataCache({ maxSize: 2 });

      smallCache.set('KEY1', { code: 'A', issuer: 'A' });
      smallCache.set('KEY2', { code: 'B', issuer: 'B' });

      // Update existing key should not trigger eviction
      smallCache.set('KEY1', { code: 'A', issuer: 'A', decimals: 6 });
      expect(smallCache.size()).toBe(2);
      expect(smallCache.has('KEY1')).toBe(true);
      expect(smallCache.has('KEY2')).toBe(true);
    });
  });

  describe('queryAssetMetadata', () => {
    it('returns cached value on hit', async () => {
      const metadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...' };
      cache.set('USDC:GA5Z...', metadata);

      const fetcher = vi.fn();
      const result = await queryAssetMetadata(cache, 'USDC:GA5Z...', fetcher);

      expect(result).toEqual(metadata);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('fetches and caches on miss', async () => {
      const metadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...' };
      const fetcher = vi.fn().mockResolvedValue(metadata);

      const result = await queryAssetMetadata(cache, 'USDC:GA5Z...', fetcher);

      expect(result).toEqual(metadata);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cache.get('USDC:GA5Z...')).toEqual(metadata);
    });

    it('fetches on stale entry', async () => {
      const oldMetadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...', decimals: 6 };
      const newMetadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...', decimals: 8 };

      cache.set('USDC:GA5Z...', oldMetadata);

      const fetcher = vi.fn().mockResolvedValue(newMetadata);

      vi.useFakeTimers();
      vi.advanceTimersByTime(800); // Within refresh window
      const result = await queryAssetMetadata(cache, 'USDC:GA5Z...', fetcher);
      vi.useRealTimers();

      expect(result).toEqual(newMetadata);
      expect(fetcher).toHaveBeenCalledOnce();
    });

    it('handles malformed TOML gracefully', async () => {
      const error = new Error('Invalid TOML');
      const fetcher = vi.fn().mockRejectedValue(error);

      await expect(
        queryAssetMetadata(cache, 'USDC:GA5Z...', fetcher),
      ).rejects.toThrow('Invalid TOML');
    });
  });

  describe('async refresh', () => {
    it('calls onRefresh callback when provided', async () => {
      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const cache2 = createAssetMetadataCache({
        ttlMs: 1000,
        onRefresh,
      });

      const metadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...' };
      cache2.set('USDC:GA5Z...', metadata);

      // Wait for refresh to be scheduled and executed
      await new Promise(resolve => setTimeout(resolve, 850));

      expect(onRefresh).toHaveBeenCalledWith('USDC:GA5Z...', metadata);
    });

    it('handles refresh errors gracefully', async () => {
      const onRefresh = vi.fn().mockRejectedValue(new Error('Refresh failed'));
      const cache2 = createAssetMetadataCache({
        ttlMs: 1000,
        onRefresh,
      });

      const metadata: AssetMetadata = { code: 'USDC', issuer: 'GA5Z...' };
      cache2.set('USDC:GA5Z...', metadata);

      // Wait for refresh attempt
      await new Promise(resolve => setTimeout(resolve, 850));

      // Entry should still be valid despite refresh error
      expect(cache2.get('USDC:GA5Z...')).toEqual(metadata);
    });
  });
});
