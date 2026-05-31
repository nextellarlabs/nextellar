import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface BodyLimitOptions {
  /**
   * Maximum request body size in bytes. Default 100_000 (100 KB).
   * Matches the express.json() default so this middleware can gate before it.
   */
  maxBytes?: number;
}

/**
 * Reject oversized request bodies before the body parser reads them.
 *
 * Two enforcement layers:
 *   1. Content-Length header early-exit — synchronous, zero-copy.
 *   2. Streaming byte accumulator — fires for chunked or unknown-size bodies.
 *
 * MUST be mounted before express.json() (or any body parser) so the raw
 * stream is still unconsumed when the data listeners attach.
 */
export function bodyLimit(options?: BodyLimitOptions): RequestHandler {
  const maxBytes = options?.maxBytes ?? 100_000;

  return function bodyLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Layer 1: Content-Length early-exit.
    const clHeader = Array.isArray(req.headers['content-length'])
      ? req.headers['content-length'][0]
      : req.headers['content-length'];

    if (clHeader !== undefined) {
      const declared = Number.parseInt(clHeader, 10);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.status(413).json({ ok: false, error: 'payload too large' });
        return;
      }
    }

    // Layer 2: Streaming guard for chunked / no Content-Length requests.
    // Uses req.resume() + Connection: close instead of req.destroy() to
    // avoid EPIPE errors on HTTP keep-alive connections.
    let received = 0;
    let rejected = false;

    req.on('data', (chunk: Buffer | string) => {
      received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (!rejected && received > maxBytes) {
        rejected = true;
        if (!res.headersSent) {
          res.setHeader('Connection', 'close');
          res.status(413).json({ ok: false, error: 'payload too large' });
        }
        req.removeAllListeners('data');
        req.resume();
      }
    });

    next();
  };
}
