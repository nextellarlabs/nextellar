import { Router, Request, Response, NextFunction } from 'express';
import {
  decodeScVal,
  ScValShape,
  DecodedScVal,
} from '../lib/sorobanStorageDecoder.js';

const router = Router();

const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  value: DecodedScVal;
  expiresAt: number;
}

const storageCache = new Map<string, CacheEntry>();

export type StorageFetcher = (
  contractId: string,
  key: string,
) => Promise<ScValShape | null>;

export const sorobanStorageDeps: { fetchStorage: StorageFetcher } = {
  async fetchStorage(_contractId: string, _key: string): Promise<ScValShape | null> {
    return null;
  },
};

function cacheKey(contractId: string, key: string): string {
  return `${contractId}:${key}`;
}

export function __clearSorobanStorageCache(): void {
  storageCache.clear();
}

/**
 * GET /soroban/storage/:contractId?key=<ledger-key>
 *
 * Returns a decoded JSON representation of the contract storage entry.
 * Responses are cached for 10 seconds.
 */
router.get(
  '/soroban/storage/:contractId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractId =
        typeof req.params.contractId === 'string'
          ? req.params.contractId.trim()
          : '';
      const key =
        typeof req.query.key === 'string' ? req.query.key.trim() : '';

      if (!contractId) {
        return res.status(400).json({ error: 'contractId is required' });
      }

      if (!key) {
        return res.status(400).json({ error: 'key query parameter is required' });
      }

      const ck = cacheKey(contractId, key);
      const now = Date.now();
      const cached = storageCache.get(ck);

      if (cached && cached.expiresAt > now) {
        return res.status(200).json({
          success: true,
          cached: true,
          data: cached.value,
        });
      }

      const scv = await sorobanStorageDeps.fetchStorage(contractId, key);

      if (scv === null) {
        return res.status(404).json({ error: 'Storage entry not found' });
      }

      const decoded = decodeScVal(scv);
      storageCache.set(ck, { value: decoded, expiresAt: now + CACHE_TTL_MS });

      return res.status(200).json({
        success: true,
        cached: false,
        data: decoded,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
