import { Router, Request, Response, NextFunction } from "express";

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
      const { id } = req.params;

      if (!UUID_REGEX.test(id)) {
        res.status(400).json({ success: false, message: "Invalid id format" });
        return;
      }

      const product = await getProductById(id);

      if (!product) {
        res.status(404).json({ success: false, message: "Product not found" });
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
// Stub — swap out for your actual service / DB layer
// ---------------------------------------------------------------------------
export async function getProductById(
  id: string,
): Promise<{ id: string; name: string } | null> {
  // Real implementation would query the DB here
  void id;
  return null;
}
