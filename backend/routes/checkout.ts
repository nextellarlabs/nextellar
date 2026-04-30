import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// Simulated DB transaction API
async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  // In a real app, this would use your DB's transaction API
  try {
    // Begin transaction
    return await fn();
    // Commit transaction
  } catch (err) {
    // Rollback transaction
    throw err;
  }
}

// Simulated DB operations
async function createOrder(order: any) {
  // ...
  return { id: "order-1", ...order };
}
async function deductInventory(productId: string, quantity: number) {
  // ...
  return { productId, quantity };
}
async function chargePayment(payment: any) {
  if (payment.fail) throw new Error("Payment failed");
  return { paymentId: "pay-1", ...payment };
}

/**
 * POST /checkout
 * Atomically: create order, deduct inventory, charge payment
 * Rolls back all on any failure
 */
router.post("/checkout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { order, productId, quantity, payment } = req.body;
    let orderResult, inventoryResult, paymentResult;
    await withTransaction(async () => {
      orderResult = await createOrder(order);
      inventoryResult = await deductInventory(productId, quantity);
      paymentResult = await chargePayment(payment);
    });
    res.status(200).json({ success: true, order: orderResult, inventory: inventoryResult, payment: paymentResult });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
