// Response compression middleware for routes-d (Issue #324).
//
// Compresses JSON and text responses with gzip or brotli when:
//   - The client advertises support via Accept-Encoding.
//   - The response body is at least `threshold` bytes.
//
// Compression is skipped for binary content types (images, streams, etc.)
// because they are already compressed and re-compressing only wastes CPU.
//
// The middleware overrides res.json() and res.send() to intercept the body
// before it is written to the socket. Synchronous zlib APIs are used so
// Express's res.json() remains synchronous (no observable API change).

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  gzipSync,
  brotliCompressSync,
  constants as zlibConstants,
} from 'node:zlib';

export interface CompressionOptions {
  /**
   * Minimum response body size in bytes below which compression is skipped.
   * Default: 1024 (1 KB).
   */
  threshold?: number;
  /**
   * Encoding preference list used when the client accepts multiple encodings.
   * Earlier entries are preferred.  Default: ['br', 'gzip'].
   */
  encodings?: Array<'br' | 'gzip'>;
}

const DEFAULT_THRESHOLD = 1024;

// Content-Type prefixes / substrings that are compressible.
const COMPRESSIBLE_RE = /^(text\/|application\/json|application\/javascript|application\/xml)/;

// ---------------------------------------------------------------------------
// Accept-Encoding parsing
// ---------------------------------------------------------------------------

interface QValue {
  encoding: string;
  q: number;
}

function parseAcceptEncoding(header: string): string[] {
  const result: QValue[] = [];
  for (const part of header.split(',')) {
    const [rawEnc, rawQ] = part.trim().split(';');
    const enc = rawEnc?.trim().toLowerCase();
    if (!enc) continue;
    let q = 1.0;
    if (rawQ) {
      const parsed = parseFloat(rawQ.replace(/^q=/i, ''));
      if (!Number.isNaN(parsed)) q = parsed;
    }
    if (q > 0) result.push({ encoding: enc, q });
  }
  return result
    .sort((a, b) => b.q - a.q)
    .map(({ encoding }) => encoding);
}

// Pick the best encoding: highest client q-value wins; ties are broken by
// server preference order (earlier entry in `supported` = more preferred).
function selectEncoding(
  accepted: string[],
  supported: string[],
): 'br' | 'gzip' | null {
  // `accepted` is already sorted descending by q-value. Position in `accepted`
  // acts as a proxy for q-rank (position 0 = highest q).
  const candidates = supported.filter((enc) => accepted.includes(enc)) as Array<'br' | 'gzip'>;
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const qRankA = accepted.indexOf(a);
    const qRankB = accepted.indexOf(b);
    if (qRankA !== qRankB) return qRankA - qRankB; // higher client q wins
    return supported.indexOf(a) - supported.indexOf(b); // server preference breaks ties
  });

  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Compression helpers
// ---------------------------------------------------------------------------

function compress(encoding: 'br' | 'gzip', data: Buffer): Buffer {
  if (encoding === 'br') {
    return brotliCompressSync(data, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
  }
  return gzipSync(data, { level: 6 });
}

function isCompressible(contentType: string): boolean {
  return COMPRESSIBLE_RE.test(contentType);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Response compression middleware.
 *
 * Mount before route handlers:
 *
 *   app.use(compression());
 *   app.use(router);
 */
export function compression(options: CompressionOptions = {}): RequestHandler {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const supported = options.encodings ?? ['br', 'gzip'];

  return function compressionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const acceptHeader = req.headers['accept-encoding'];
    const accepted = acceptHeader ? parseAcceptEncoding(String(acceptHeader)) : [];
    const encoding = selectEncoding(accepted, supported);

    if (!encoding) {
      return next();
    }

    // Inform caches that the response varies by encoding.
    res.setHeader('Vary', 'Accept-Encoding');

    const originalJson = res.json.bind(res) as typeof res.json;
    const originalSend = res.send.bind(res) as typeof res.send;

    function tryCompress(bodyStr: string): { compressed: Buffer; encoding: 'br' | 'gzip' } | null {
      const ct = String(res.getHeader('Content-Type') ?? 'application/json');
      if (!isCompressible(ct)) return null;

      const raw = Buffer.from(bodyStr, 'utf8');
      if (raw.length < threshold) return null;

      return { compressed: compress(encoding!, raw), encoding: encoding! };
    }

    res.json = function compressedJson(data) {
      const bodyStr = JSON.stringify(data);
      const result = tryCompress(bodyStr);

      if (!result) {
        return originalJson(data);
      }

      res.setHeader('Content-Encoding', result.encoding);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', result.compressed.length);
      res.removeHeader('Transfer-Encoding');
      res.status(res.statusCode);
      res.end(result.compressed);
      return res;
    };

    res.send = function compressedSend(body) {
      // Only intercept string/Buffer bodies; pass others through.
      const bodyStr =
        typeof body === 'string'
          ? body
          : Buffer.isBuffer(body)
            ? body.toString('utf8')
            : null;

      if (bodyStr === null) return originalSend(body);

      const result = tryCompress(bodyStr);
      if (!result) return originalSend(body);

      res.setHeader('Content-Encoding', result.encoding);
      res.setHeader('Content-Length', result.compressed.length);
      res.removeHeader('Transfer-Encoding');
      res.end(result.compressed);
      return res;
    };

    next();
  };
}
