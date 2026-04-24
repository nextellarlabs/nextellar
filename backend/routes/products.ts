import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /products/:id
 * - 400 if id is not a valid UUID
 * - 404 if no product matches the id
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
  async getProductById(
    _id: string,
  ): Promise<{ id: string; name: string } | null> {
    return null;
  },
};

export const getProductById = (id: string) => deps.getProductById(id);
