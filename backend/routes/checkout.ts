import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// ---------------------------------------------------------------------------
// In-memory stores (swap for real DB/payment service in production)
// ---------------------------------------------------------------------------

export interface Order {
  id: string;
  userId: string;
  items: CheckoutItem[];
  total: number;
  status: string;
  createdAt: string;
}

export interface CheckoutItem {
  productId: string;
  quantity: number;
  price: number;
}

const orders: Order[] = [];
const inventory: Record<string, number> = {};

export function seedInventory(items: Record<string, number>): void {
  Object.assign(inventory, items);
}

export function getOrders(): Order[] {
  return orders;
}

export function resetCheckoutState(): void {
  orders.length = 0;
  for (const key of Object.keys(inventory)) {
    delete inventory[key];
  }
}

// ---------------------------------------------------------------------------
// Service stubs — each returns void or throws on failure
// ---------------------------------------------------------------------------

async function createOrder(order: Order): Promise<void> {
  orders.push(order);
}

async function deductInventory(items: CheckoutItem[]): Promise<void> {
  for (const item of items) {
    const current = inventory[item.productId] ?? 0;
    if (current < item.quantity) {
      throw new Error(`Insufficient stock for product ${item.productId}`);
    }
    inventory[item.productId] = current - item.quantity;
  }
}

async function chargePayment(
  userId: string,
  total: number,
): Promise<void> {
  // Simulate a payment provider call that can fail.
  if (process.env.SIMULATE_PAYMENT_FAILURE === "true") {
    throw new Error("Payment provider declined the transaction");
  }
  void userId;
  void total;
}

// ---------------------------------------------------------------------------
// Transaction helpers — rollback restores pre-attempt state
// ---------------------------------------------------------------------------

async function rollbackOrder(orderId: string): Promise<void> {
  const index = orders.findIndex((o) => o.id === orderId);
  if (index !== -1) orders.splice(index, 1);
}

async function rollbackInventory(items: CheckoutItem[]): Promise<void> {
  for (const item of items) {
    inventory[item.productId] = (inventory[item.productId] ?? 0) + item.quantity;
  }
}

// ---------------------------------------------------------------------------
// POST /checkout
// ---------------------------------------------------------------------------

/**
 * POST /checkout
 *
 * Atomically:
 *  1. Creates an order record
 *  2. Deducts inventory for each line item
 *  3. Charges the payment provider
 *
 * If any step throws, ALL prior writes are rolled back so the datastore is
 * never left in a partially-written state.
 */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  const { userId, items } = req.body as {
    userId?: string;
    items?: CheckoutItem[];
  };

  if (!userId || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, message: "userId and items are required" });
    return;
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const order: Order = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    items,
    total,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };

  let orderCreated = false;
  let inventoryDeducted = false;

  try {
    // Step 1: persist the order
    await createOrder(order);
    orderCreated = true;

    // Step 2: deduct inventory
    await deductInventory(items);
    inventoryDeducted = true;

    // Step 3: charge payment — if this throws, steps 1 & 2 are rolled back
    await chargePayment(userId, total);

    res.status(201).json({ success: true, data: { orderId: order.id, total } });
  } catch (err) {
    // Rollback in reverse order of writes
    if (inventoryDeducted) await rollbackInventory(items);
    if (orderCreated) await rollbackOrder(order.id);

    next(err);
  }
});

export default router;
