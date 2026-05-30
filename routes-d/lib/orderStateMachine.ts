// Order status state machine for routes-d (#297).
//
// Encodes the legal lifecycle so an update route cannot accidentally
// skip stages (`pending → delivered`) or reverse them
// (`shipped → paid`). The map is the single source of truth — both the
// validator and downstream consumers (e.g. the webhook publisher in
// `orderWebhooks.ts`) read from it.

export type OrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/**
 * Allowed forward transitions. Terminal statuses (`delivered`,
 * `cancelled`, `refunded`) have empty arrays — nothing transitions out
 * of them.
 *
 * `cancelled` is reachable from any non-terminal status. `refunded` is
 * reachable only from `delivered` (you cannot refund what was never
 * fulfilled — that's a `cancelled`, not a refund).
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["paid", "cancelled"],
  paid: ["fulfilled", "cancelled"],
  fulfilled: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const ORDER_STATUSES: readonly OrderStatus[] = Object.freeze(
  Object.keys(ORDER_TRANSITIONS) as OrderStatus[],
);

export interface TransitionResult {
  ok: boolean;
  /** Filled when `ok === false`. */
  reason?: string;
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && value in ORDER_TRANSITIONS;
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * Returns `{ ok: true }` if `from → to` is in the allowed transitions
 * map; otherwise `{ ok: false, reason }` with a human-readable reason
 * the HTTP layer can echo back. Same-state transitions
 * (`from === to`) are rejected — every update must change the status.
 */
export function validateTransition(from: OrderStatus, to: OrderStatus): TransitionResult {
  if (from === to) {
    return { ok: false, reason: `order is already in '${to}'` };
  }
  if (isTerminal(from)) {
    return {
      ok: false,
      reason: `'${from}' is terminal; cannot transition to '${to}'`,
    };
  }
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: `illegal transition '${from}' → '${to}'`,
    };
  }
  return { ok: true };
}

export class IllegalTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  constructor(from: OrderStatus, to: OrderStatus, reason: string) {
    super(reason);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Throws `IllegalTransitionError` when the transition is rejected.
 * Routes can catch this and translate it into a `409 Conflict` with the
 * `.message` echoed back to the client.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  const result = validateTransition(from, to);
  if (!result.ok) {
    throw new IllegalTransitionError(from, to, result.reason ?? "illegal transition");
  }
}
