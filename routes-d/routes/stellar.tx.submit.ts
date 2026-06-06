// routes-d/routes/stellar.tx.submit.ts
//
// POST /stellar/tx/submit — accept a client-signed envelope and forward it
// to the Stellar network (Issue #273).
//
// The route re-validates the declared operation types against the allowlist
// before submitting so a tampered envelope cannot bypass the prepare-time
// check. The actual network submission is injected via `SubmitTransactionDeps`.

import { Router, type Request, type Response } from 'express';
import {
  checkOperations,
  DEFAULT_ALLOWED_OPERATIONS,
} from '../lib/operationAllowlist.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmitOperation {
  type: string;
  [key: string]: unknown;
}

export interface SubmitRequest {
  /** Base64-encoded signed transaction XDR. */
  envelope: string;
  /** Operations the envelope contains (client-supplied for allowlist check). */
  operations: SubmitOperation[];
}

export interface SubmitResult {
  /** Transaction hash returned by the network. */
  hash: string;
  /** Ledger the transaction was included in. */
  ledger?: number;
  /** ISO timestamp of submission. */
  submittedAt: string;
}

export interface SubmitTransactionDeps {
  /**
   * Submit a signed envelope to the Stellar network.
   * Returns the transaction hash and optional ledger number.
   */
  submitEnvelope(envelope: string): Promise<SubmitResult>;
  /** Allowlist of permitted operation types. */
  allowedOperations?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Default deps (placeholder — wire real Stellar SDK in production)
// ---------------------------------------------------------------------------

export const defaultSubmitDeps: SubmitTransactionDeps = {
  async submitEnvelope(envelope: string): Promise<SubmitResult> {
    // Placeholder: real implementation calls Horizon /transactions
    return {
      hash: `mock-hash-${Buffer.from(envelope).toString('hex').slice(0, 16)}`,
      submittedAt: new Date().toISOString(),
    };
  },
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function readSubmitRequest(body: unknown): SubmitRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  if (typeof b.envelope !== 'string' || !b.envelope.trim()) return null;
  if (!Array.isArray(b.operations) || b.operations.length === 0) return null;

  for (const op of b.operations) {
    if (!op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') {
      return null;
    }
  }

  return {
    envelope: b.envelope.trim(),
    operations: b.operations as SubmitOperation[],
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface CreateSubmitRouterOptions {
  deps?: SubmitTransactionDeps;
}

export function createSubmitRouter(opts: CreateSubmitRouterOptions = {}): Router {
  const router = Router();
  const deps = opts.deps ?? defaultSubmitDeps;
  const allowlist = deps.allowedOperations ?? DEFAULT_ALLOWED_OPERATIONS;

  router.post('/submit', async (req: Request, res: Response) => {
    const payload = readSubmitRequest(req.body);
    if (!payload) {
      res.status(400).json({
        ok: false,
        error: 'envelope (string) and operations (non-empty array of {type}) are required',
      });
      return;
    }

    const opTypes = payload.operations.map((op) => op.type);
    const check = checkOperations(opTypes, allowlist);
    if (!check.allowed) {
      res.status(403).json({
        ok: false,
        error: `disallowed operation type(s): ${check.disallowed.join(', ')}`,
        disallowed: check.disallowed,
      });
      return;
    }

    let result: SubmitResult;
    try {
      result = await deps.submitEnvelope(payload.envelope);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submission failed';
      res.status(502).json({ ok: false, error: message });
      return;
    }

    res.status(200).json({ ok: true, data: result });
  });

  return router;
}

export default createSubmitRouter();
