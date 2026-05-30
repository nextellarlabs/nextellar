// POST /soroban/invoke — invoke a Soroban contract method through the
// server so the caller never needs to know the Soroban RPC URL or hold
// the signing keypair. The full pipeline (simulate → sign → submit →
// poll) lives in `routes-d/lib/sorobanClient.ts`; this handler is the
// HTTP shell that translates JSON in / JSON out around it.

import { Router, type Request, type Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import {
  invokeContract,
  createDefaultSorobanClient,
  type InvocationOutcome,
  type SorobanRpcLike,
} from '../lib/sorobanClient.js';

export interface SorobanInvokeRouterOptions {
  /** Override the RPC client (tests use this to inject a fake). */
  rpc?: SorobanRpcLike;
  networkPassphrase?: string;
  /** Override the signing secret resolver. The default reads
   *  `SOROBAN_SIGNING_SECRET` from the environment. */
  resolveSigner?: () => string;
}

interface InvokeBody {
  contractId?: unknown;
  method?: unknown;
  args?: unknown;
}

function isStringArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function createSorobanInvokeRouter(
  options: SorobanInvokeRouterOptions = {},
): Router {
  const router = Router();
  const fallback = options.rpc ? null : createDefaultSorobanClient();
  const rpc: SorobanRpcLike = options.rpc ?? (fallback as { rpc: SorobanRpcLike }).rpc;
  const networkPassphrase =
    options.networkPassphrase ?? (fallback ? fallback.networkPassphrase : 'Test SDF Network ; September 2015');
  const resolveSigner =
    options.resolveSigner ?? (() => process.env.SOROBAN_SIGNING_SECRET ?? '');

  router.post('/invoke', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as InvokeBody;

    if (typeof body.contractId !== 'string' || body.contractId.length === 0) {
      res.status(400).json({ ok: false, error: 'contractId is required' });
      return;
    }
    if (typeof body.method !== 'string' || body.method.length === 0) {
      res.status(400).json({ ok: false, error: 'method is required' });
      return;
    }
    if (body.args !== undefined && !isStringArray(body.args)) {
      res.status(400).json({ ok: false, error: 'args must be an array' });
      return;
    }

    const secret = resolveSigner();
    if (!secret) {
      res
        .status(500)
        .json({ ok: false, error: 'server is not configured with a signing secret' });
      return;
    }

    let signer;
    try {
      signer = Keypair.fromSecret(secret);
    } catch {
      res.status(500).json({ ok: false, error: 'configured signing secret is invalid' });
      return;
    }

    const outcome: InvocationOutcome = await invokeContract(rpc, {
      contractId: body.contractId,
      method: body.method,
      args: (body.args as unknown[] | undefined) ?? [],
      signer,
      networkPassphrase,
    });

    if (outcome.ok) {
      res.status(200).json(outcome);
      return;
    }

    // 502 for upstream RPC issues, 400 for caller-driven failures
    // (simulation rejected the call), 409 for on-chain reverts.
    const status =
      outcome.code === 'SIMULATION_FAILED'
        ? 400
        : outcome.code === 'REVERT'
          ? 409
          : 502;
    res.status(status).json(outcome);
  });

  return router;
}
