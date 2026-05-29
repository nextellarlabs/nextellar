import { createHash } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Product {
  id: string;
  name: string;
  updated_at?: string; // ISO 8601
}

function stableStringify(val: unknown): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  const keys = Object.keys(val as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function generateETag(data: unknown): string {
  const hash = createHash("sha256").update(stableStringify(data)).digest("hex");
  return `"${hash}"`;
}

function parseLastModified(product: Product): Date | null {
  if (!product.updated_at) return null;
  const d = new Date(product.updated_at);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * GET /products/:id
 * - 400 if id is not a valid UUID
 * - 404 if no product matches the id
 * - 304 if conditional GET matches (If-None-Match / If-Modified-Since)
 * - 200 with product data on success
 */
router.get(
  "/products/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params['id'] as string;

      if (!UUID_REGEX.test(id)) {
        sendError(res, 'INVALID_ID', 'Invalid id format', 400);
        return;
      }

      const product = await deps.getProductById(id);

      if (!product) {
        sendError(res, 'NOT_FOUND', 'Product not found', 404);
        return;
      }

      const etag = generateETag(product);
      const lastModified = parseLastModified(product);

      // Evaluate If-None-Match
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch) {
        // Support comma-separated list and wildcard per RFC 7232 §3.2
        const tags = ifNoneMatch.split(',').map((t) => t.trim());
        if (tags.includes('*') || tags.includes(etag)) {
          res.setHeader('ETag', etag);
          if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString());
          res.status(304).end();
          return;
        }
      }

      // Evaluate If-Modified-Since (only when If-None-Match absent per RFC 7232 §6)
      if (!ifNoneMatch && lastModified) {
        const ifModifiedSince = req.headers['if-modified-since'];
        if (ifModifiedSince) {
          const since = new Date(ifModifiedSince);
          if (!isNaN(since.getTime()) && lastModified <= since) {
            res.setHeader('ETag', etag);
            res.setHeader('Last-Modified', lastModified.toUTCString());
            res.status(304).end();
            return;
          }
        }
      }

      res.setHeader('ETag', etag);
      if (lastModified) res.setHeader('Last-Modified', lastModified.toUTCString());
      res.status(200).json({ success: true, data: product });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stub — swap out for your actual service / DB layer.
// Exported as a mutable object so tests can spy on individual methods
// without needing jest.mock() factory hoisting.
// ---------------------------------------------------------------------------
export const deps = {
  async getProductById(_id: string): Promise<Product | null> {
    return null;
  },
};

export const getProductById = (id: string) => deps.getProductById(id);
