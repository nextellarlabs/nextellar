import type { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'node:crypto';

/**
 * Idempotency middleware for non-safe HTTP methods (POST, PATCH, PUT).
 *
 * Protocol
 * --------
 * 1. Client sends `Idempotency-Key: <uuid>` on any state-mutating request.
 * 2. On the first request for a key the handler runs normally; the
 *    response status + body are stored under that key.
 * 3. On any subsequent request with the same key the stored response is
 *    replayed immediately — the handler is NOT called again.
 * 4. If the key is currently being processed (a concurrent duplicate) the
 *    middleware returns 409 Conflict.
 *
 * The in-memory store is suitable for single-node deployments. For
 * multi-node production, replace `idempotencyStore` with a Redis-backed
 * implementation that exposes the same interface.
 */

const MAX_KEY_LENGTH = 128;
const STORE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface StoredResponse {
  status: number;
  body: unknown;
  storedAt: number;
}

interface InFlightEntry {
  inFlight: true;
}

type StoreEntry = StoredResponse | InFlightEntry;

export class IdempotencyStore {
  private readonly entries = new Map<string, StoreEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = STORE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  get(key: string): StoreEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if ('inFlight' in entry) return entry;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  setInFlight(key: string): void {
    this.entries.set(key, { inFlight: true });
  }

  store(key: string, status: number, body: unknown): void {
    this.entries.set(key, { status, body, storedAt: Date.now() });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const idempotencyStore = new IdempotencyStore();

export interface IdempotencyOptions {
  store?: IdempotencyStore;
  /** Methods to enforce idempotency on (default: POST, PATCH, PUT). */
  methods?: string[];
  /** Header name (default: 'Idempotency-Key'). */
  headerName?: string;
}

function isValidKey(key: string): boolean {
  if (!key || key.length > MAX_KEY_LENGTH) return false;
  // Require printable ASCII only
  return /^[\x21-\x7e]+$/.test(key);
}

/**
 * Build the idempotency middleware. Attach before route handlers.
 *
 * @example
 *   router.post('/payments', idempotency(), paymentHandler);
 */
export function idempotency(options: IdempotencyOptions = {}): RequestHandler {
  const store = options.store ?? idempotencyStore;
  const methods = new Set(
    (options.methods ?? ['POST', 'PATCH', 'PUT']).map((m) => m.toUpperCase()),
  );
  const header = (options.headerName ?? 'Idempotency-Key').toLowerCase();

  return function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!methods.has(req.method.toUpperCase())) {
      return next();
    }

    const rawKey = req.headers[header];
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (!key) {
      // No key supplied — pass through; route may choose to reject
      return next();
    }

    if (!isValidKey(key)) {
      res.status(400).json({ error: 'invalid_idempotency_key' });
      return;
    }

    const existing = store.get(key);

    if (existing) {
      if ('inFlight' in existing) {
        res.status(409).json({ error: 'request_in_flight' });
        return;
      }
      // Replay stored response
      res.status(existing.status).json(existing.body);
      return;
    }

    // Mark as in-flight before handing off to the handler
    store.setInFlight(key);

    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res) as typeof res.json;
    res.json = function captureJson(body) {
      store.store(key, res.statusCode, body);
      return originalJson(body);
    };

    // If something throws remove the in-flight lock so retries can proceed
    res.on('close', () => {
      const entry = store.get(key);
      if (entry && 'inFlight' in entry) {
        store.delete(key);
      }
    });

    next();
  };
}