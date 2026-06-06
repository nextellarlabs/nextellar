// POST /stellar/tx/cosign — server co-signature endpoint for routes-d
// (#280).
//
// Some Nextellar flows (e.g. multi-sig recovery, treasury-gated trades)
// require the server to add its signature before the client signs and
// submits. The route validates the operations in the supplied envelope
// against a configurable allowlist and only co-signs envelopes whose
// every operation type is allowed.
//
// The signer is injected at router construction time so tests can
// substitute a deterministic mock without ever loading a real key. In
// production the host wires `loadCosignerFromEnv` (or a custom variant
// that reads from a secret manager) once at startup. The key is never
// logged — only its derived public account id ever leaves this module.

import { Router, type Request, type Response } from "express";

/**
 * A transaction operation as it appears on the inbound payload. We only
 * care about `type` for allowlisting — the actual signing payload is the
 * pre-built envelope XDR / base64 string.
 */
export interface CosignOperation {
  type: string;
  [key: string]: unknown;
}

export interface CosignEnvelope {
  /** Base64 / XDR-encoded transaction envelope. */
  envelope: string;
  /** Operations the envelope contains, supplied by the client so the
   *  server can allowlist without re-parsing XDR. */
  operations: CosignOperation[];
}

export interface CosignerSigner {
  /** Public account id (G...) the signer represents — safe to log. */
  publicKey: string;
  /** Produces a base64 signature for `envelope`. Implementations must
   *  never log the secret key. */
  sign(envelope: string): Promise<string> | string;
}

export interface CosignRouterOptions {
  signer: CosignerSigner;
  /** Operation types the server will co-sign. Anything else → 403. */
  allowedOperations: Iterable<string>;
}

export class CosignDisallowedError extends Error {
  readonly disallowed: string[];
  constructor(disallowed: string[]) {
    super(`disallowed operation type(s): ${disallowed.join(", ")}`);
    this.name = "CosignDisallowedError";
    this.disallowed = disallowed;
  }
}

function readEnvelope(body: unknown): CosignEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.envelope !== "string" || b.envelope.trim() === "") return null;
  if (!Array.isArray(b.operations) || b.operations.length === 0) return null;
  for (const op of b.operations) {
    if (!op || typeof op !== "object" || typeof (op as { type?: unknown }).type !== "string") {
      return null;
    }
  }
  return {
    envelope: b.envelope,
    operations: b.operations as CosignOperation[],
  };
}

/**
 * Inspect an envelope against an allow-set. Returns the list of
 * disallowed operation types (empty when everything is allowed).
 * Pure — extracted so the test suite can exercise it without HTTP.
 */
export function findDisallowedOperations(
  operations: readonly CosignOperation[],
  allowed: ReadonlySet<string>,
): string[] {
  const bad: string[] = [];
  for (const op of operations) {
    if (!allowed.has(op.type)) bad.push(op.type);
  }
  return bad;
}

/**
 * Load a cosigner from the process environment. The secret key is read
 * from `STELLAR_COSIGNER_SECRET` and the public key from
 * `STELLAR_COSIGNER_PUBLIC`. Both must be set; missing values throw
 * with a non-leaking message so a misconfigured deploy fails fast.
 *
 * The default `sign` implementation here is a placeholder that delegates
 * to a `signerFn` the host wires in — keeping the cryptographic
 * dependency out of routes-d so the package stays portable.
 */
export function loadCosignerFromEnv(
  signerFn: (secret: string, envelope: string) => string | Promise<string>,
  env: NodeJS.ProcessEnv = process.env,
): CosignerSigner {
  const publicKey = env.STELLAR_COSIGNER_PUBLIC;
  const secret = env.STELLAR_COSIGNER_SECRET;
  if (!publicKey || !secret) {
    throw new Error(
      "STELLAR_COSIGNER_PUBLIC and STELLAR_COSIGNER_SECRET must be set to enable cosigning",
    );
  }
  return {
    publicKey,
    sign: (envelope) => signerFn(secret, envelope),
  };
}

export function createCosignRouter(opts: CosignRouterOptions): Router {
  const allowed = new Set<string>(opts.allowedOperations);
  if (allowed.size === 0) {
    throw new Error("createCosignRouter: allowedOperations must be non-empty");
  }

  const router = Router();

  router.post("/cosign", async (req: Request, res: Response) => {
    const payload = readEnvelope(req.body);
    if (!payload) {
      res.status(400).json({
        ok: false,
        error: "envelope (string) and operations (non-empty array of {type}) are required",
      });
      return;
    }

    const disallowed = findDisallowedOperations(payload.operations, allowed);
    if (disallowed.length > 0) {
      res.status(403).json({
        ok: false,
        error: new CosignDisallowedError(disallowed).message,
        disallowed,
      });
      return;
    }

    let signature: string;
    try {
      signature = await opts.signer.sign(payload.envelope);
    } catch {
      // Surface a generic message — the underlying error may carry the
      // secret in its stack on some signer implementations.
      res.status(500).json({ ok: false, error: "cosigner failed to sign" });
      return;
    }

    res.status(200).json({
      ok: true,
      signature,
      signer: opts.signer.publicKey,
    });
  });

  return router;
}
