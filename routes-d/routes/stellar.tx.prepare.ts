// routes-d/routes/stellar.tx.prepare.ts
//
// POST /stellar/tx/prepare — build an unsigned Stellar transaction envelope
// that the client can sign and later submit via /stellar/tx/submit (Issue #273).
//
// The route validates every requested operation type against the allowlist
// before building the envelope. If any operation is disallowed the request
// is rejected with 403 so the client never receives an envelope it cannot
// submit.
//
// The actual XDR construction is injected via `PrepareTransactionDeps` so
// the route stays portable and tests can supply deterministic envelopes
// without a real Stellar SDK.

import { Router, type Request, type Response } from 'express';
import {
  checkOperations,
  DEFAULT_ALLOWED_OPERATIONS,
} from '../lib/operationAllowlist.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepareOperation {
  /** Stellar operation type, e.g. "payment", "manageData". */
  type: string;
  [key: string]: unknown;
}

export interface PrepareRequest {
  /** Source account (G… address). */
  sourceAccount: string;
  /** Operations to include in the transaction. */
  operations: PrepareOperation[];
  /** Optional memo string. */
  memo?: string;
  /** Optional fee in stroops (defaults to 100 per operation). */
  fee?: number;
}

export interface PrepareEnvelope {
  /** Base64-encoded unsigned transaction XDR. */
  envelope: string;
  /** Network passphrase the envelope was built for. */
  network: string;
  /** Operations included (echoed back for client verification). */
  operations: PrepareOperation[];
  /** Source account. */
  sourceAccount: string;
}

export interface PrepareTransactionDeps {
  /**
   * Build an unsigned transaction envelope from the given parameters.
   * Returns a base64 XDR string. Injected so tests avoid real SDK calls.
   */
  buildEnvelope(params: {
    sourceAccount: string;
    operations: PrepareOperation[];
    memo?: string;
    fee: number;
    network: string;
  }): Promise<string> | string;
  /** Network passphrase. Defaults to testnet. */
  network?: string;
  /** Allowlist of permitted operation types. */
  allowedOperations?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Default deps (placeholder — wire real Stellar SDK in production)
// ---------------------------------------------------------------------------

export const defaultPrepareDeps: PrepareTransactionDeps = {
  buildEnvelope({ sourceAccount, operations, fee, network }) {
    // Placeholder: real implementation uses @stellar/stellar-sdk
    const payload = JSON.stringify({ sourceAccount, operations, fee, network });
    return Buffer.from(payload).toString('base64');
  },
  network: process.env.STELLAR_NETWORK ?? 'Test SDF Network ; September 2015',
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function readPrepareRequest(body: unknown): PrepareRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;

  if (typeof b.sourceAccount !== 'string' || !b.sourceAccount.trim()) return null;
  if (!Array.isArray(b.operations) || b.operations.length === 0) return null;

  for (const op of b.operations) {
    if (!op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') {
      return null;
    }
  }

  return {
    sourceAccount: (b.sourceAccount as string).trim(),
    operations: b.operations as PrepareOperation[],
    memo: typeof b.memo === 'string' ? b.memo : undefined,
    fee: typeof b.fee === 'number' && b.fee > 0 ? b.fee : undefined,
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export interface CreatePrepareRouterOptions {
  deps?: PrepareTransactionDeps;
}

export function createPrepareRouter(opts: CreatePrepareRouterOptions = {}): Router {
  const router = Router();
  const deps = opts.deps ?? defaultPrepareDeps;
  const allowlist = deps.allowedOperations ?? DEFAULT_ALLOWED_OPERATIONS;
  const network = deps.network ?? 'Test SDF Network ; September 2015';
  const DEFAULT_FEE_PER_OP = 100;

  router.post('/prepare', async (req: Request, res: Response) => {
    const payload = readPrepareRequest(req.body);
    if (!payload) {
      res.status(400).json({
        ok: false,
        error: 'sourceAccount (string) and operations (non-empty array of {type}) are required',
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

    const fee = payload.fee ?? DEFAULT_FEE_PER_OP * payload.operations.length;

    let envelope: string;
    try {
      envelope = await deps.buildEnvelope({
        sourceAccount: payload.sourceAccount,
        operations: payload.operations,
        memo: payload.memo,
        fee,
        network,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'failed to build transaction envelope' });
      return;
    }

    const result: PrepareEnvelope = {
      envelope,
      network,
      operations: payload.operations,
      sourceAccount: payload.sourceAccount,
    };

    res.status(200).json({ ok: true, data: result });
  });

  return router;
}

export default createPrepareRouter();
