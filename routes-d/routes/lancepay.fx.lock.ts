import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long (ms) a rate lock remains valid before it is automatically released. */
const FX_LOCK_TTL_MS = 30_000; // 30 seconds

/** Supported currency pair codes. */
const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "USDC", "XLM", "BRL", "MXN", "NGN"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FxLockStatus = "active" | "expired" | "consumed";

export type FxLock = {
  lockId: string;
  workspaceId: string;
  draftId: string;
  fromCurrency: string;
  toCurrency: string;
  /** Locked mid-market rate: 1 unit of fromCurrency = rate units of toCurrency */
  rate: number;
  /** Notional amount being locked in fromCurrency units */
  lockedAmount: number;
  status: FxLockStatus;
  createdAt: string;
  expiresAt: string;
  /** ISO timestamp when the lock was consumed or expired, absent while active */
  resolvedAt?: string;
};

type LockFxRateBody = {
  workspaceId: string;
  draftId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
};

// ---------------------------------------------------------------------------
// In-memory stores (swap for Redis / DB in production)
// ---------------------------------------------------------------------------

/** Active and historical rate locks, keyed by lockId. */
const fxLocks = new Map<string, FxLock>();

/**
 * One timer handle per active lock.  Cleared when the lock is consumed or
 * expired so the process does not hold stale handles.
 */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Tracks how many active locks a workspace currently holds. */
const workspaceLockCount = new Map<string, number>();

/** Maximum concurrent active locks per workspace (simple abuse guard). */
const MAX_ACTIVE_LOCKS_PER_WORKSPACE = 10;

// ---------------------------------------------------------------------------
// Rate simulation (replace with live FX feed in production)
// ---------------------------------------------------------------------------

/**
 * Returns a simulated mid-market rate for fromCurrency → toCurrency.
 * Applies a tiny random spread on each call so prices feel live.
 */
function fetchRate(fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return 1;

  // Deterministic USD-based cross rates (mid-market approximation)
  const usdRates: Record<string, number> = {
    USD: 1,
    EUR: 0.9215,
    GBP: 0.7883,
    USDC: 1,
    XLM: 8.3412,
    BRL: 4.9750,
    MXN: 17.1523,
    NGN: 1540.0,
  };

  const fromUsd = usdRates[fromCurrency];
  const toUsd = usdRates[toCurrency];

  if (fromUsd === undefined || toUsd === undefined) return 0;

  const midRate = toUsd / fromUsd;
  // ±0.05% random jitter to simulate a live feed
  const jitter = 1 + (Math.random() - 0.5) * 0.001;
  return parseFloat((midRate * jitter).toFixed(7));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Decrement the workspace's active-lock counter (floor at 0). */
function decrementWorkspaceLockCount(workspaceId: string): void {
  const current = workspaceLockCount.get(workspaceId) ?? 0;
  const updated = Math.max(0, current - 1);
  if (updated === 0) {
    workspaceLockCount.delete(workspaceId);
  } else {
    workspaceLockCount.set(workspaceId, updated);
  }
}

/**
 * Mark a lock as expired in place, cancel its timer if still pending,
 * and update book-keeping counters.
 */
function expireLock(lockId: string): void {
  const lock = fxLocks.get(lockId);
  if (!lock || lock.status !== "active") return;

  lock.status = "expired";
  lock.resolvedAt = new Date().toISOString();

  const timer = expiryTimers.get(lockId);
  if (timer !== undefined) {
    clearTimeout(timer);
    expiryTimers.delete(lockId);
  }

  decrementWorkspaceLockCount(lock.workspaceId);
}

/**
 * Schedule automatic expiry for a lock.
 * Stored so the handle can be cleared on early consumption.
 */
function scheduleLockExpiry(lockId: string, ttlMs: number): void {
  const handle = setTimeout(() => {
    expireLock(lockId);
    expiryTimers.delete(lockId);
  }, ttlMs);

  // Allow Node.js to exit even if a lock timer is still pending
  if (typeof handle === "object" && "unref" in handle) {
    (handle as NodeJS.Timeout).unref();
  }

  expiryTimers.set(lockId, handle);
}

// ---------------------------------------------------------------------------
// Route: POST /lancepay/fx/lock
// ---------------------------------------------------------------------------

/**
 * POST /lancepay/fx/lock
 *
 * Securely binds an FX rate lock to a workspace and a payout draft.
 * The lock is valid for FX_LOCK_TTL_MS milliseconds.  Once the window
 * lapses the lock is automatically marked "expired" and the rate
 * reservation is released so the workspace may request a fresh quote.
 *
 * Request body:
 *   workspaceId  string  – owning workspace
 *   draftId      string  – payout draft the lock is bound to
 *   fromCurrency string  – source currency code (e.g. "USD")
 *   toCurrency   string  – target currency code (e.g. "EUR")
 *   amount       number  – notional amount in fromCurrency
 *
 * Responses:
 *   201  Lock created successfully
 *   400  Validation error
 *   409  Draft already has an active lock
 *   422  Unsupported currency pair / zero rate returned
 *   429  Workspace active-lock limit reached
 */
router.post(
  "/lancepay/fx/lock",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as LockFxRateBody;

      // --- Validate workspaceId ---
      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }
      const workspaceId = body.workspaceId.trim();
      if (workspaceId.length === 0) {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId must not be blank", 400);
        return;
      }

      // --- Validate draftId ---
      if (!body.draftId || typeof body.draftId !== "string") {
        sendError(res, "INVALID_DRAFT_ID", "draftId is required", 400);
        return;
      }
      const draftId = body.draftId.trim();
      if (draftId.length === 0) {
        sendError(res, "INVALID_DRAFT_ID", "draftId must not be blank", 400);
        return;
      }

      // --- Validate fromCurrency ---
      if (!body.fromCurrency || typeof body.fromCurrency !== "string") {
        sendError(res, "INVALID_FROM_CURRENCY", "fromCurrency is required", 400);
        return;
      }
      const fromCurrency = body.fromCurrency.trim().toUpperCase();
      if (!VALID_CURRENCIES.has(fromCurrency)) {
        sendError(
          res,
          "INVALID_FROM_CURRENCY",
          `fromCurrency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      // --- Validate toCurrency ---
      if (!body.toCurrency || typeof body.toCurrency !== "string") {
        sendError(res, "INVALID_TO_CURRENCY", "toCurrency is required", 400);
        return;
      }
      const toCurrency = body.toCurrency.trim().toUpperCase();
      if (!VALID_CURRENCIES.has(toCurrency)) {
        sendError(
          res,
          "INVALID_TO_CURRENCY",
          `toCurrency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      // --- Currencies must differ ---
      if (fromCurrency === toCurrency) {
        sendError(
          res,
          "SAME_CURRENCY_PAIR",
          "fromCurrency and toCurrency must be different",
          400,
        );
        return;
      }

      // --- Validate amount ---
      if (typeof body.amount !== "number" || !isFinite(body.amount) || body.amount <= 0) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive finite number", 400);
        return;
      }

      // --- Conflict guard: draft must not already hold an active lock ---
      for (const lock of fxLocks.values()) {
        if (
          lock.draftId === draftId &&
          lock.workspaceId === workspaceId &&
          lock.status === "active"
        ) {
          sendError(
            res,
            "DRAFT_LOCK_EXISTS",
            `Draft ${draftId} already has an active FX lock (lockId: ${lock.lockId})`,
            409,
          );
          return;
        }
      }

      // --- Rate-limit: cap concurrent active locks per workspace ---
      const activeLocks = workspaceLockCount.get(workspaceId) ?? 0;
      if (activeLocks >= MAX_ACTIVE_LOCKS_PER_WORKSPACE) {
        sendError(
          res,
          "LOCK_LIMIT_REACHED",
          `Workspace has reached the maximum of ${MAX_ACTIVE_LOCKS_PER_WORKSPACE} concurrent FX locks`,
          429,
        );
        return;
      }

      // --- Fetch live rate ---
      const rate = fetchRate(fromCurrency, toCurrency);
      if (rate <= 0) {
        sendError(
          res,
          "RATE_UNAVAILABLE",
          `FX rate unavailable for pair ${fromCurrency}/${toCurrency}`,
          422,
        );
        return;
      }

      // --- Create the lock ---
      const lockId = `fxlock-${crypto.randomUUID()}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + FX_LOCK_TTL_MS);

      const lock: FxLock = {
        lockId,
        workspaceId,
        draftId,
        fromCurrency,
        toCurrency,
        rate,
        lockedAmount: body.amount,
        status: "active",
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      fxLocks.set(lockId, lock);
      workspaceLockCount.set(workspaceId, activeLocks + 1);
      scheduleLockExpiry(lockId, FX_LOCK_TTL_MS);

      return res.status(201).json({
        success: true,
        data: lock,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Test helpers (double-underscore prefix = internal, not part of public API)
// ---------------------------------------------------------------------------

export function __getFxLocks(): Map<string, FxLock> {
  return fxLocks;
}

export function __resetFxLocks(): void {
  // Cancel all pending expiry timers before clearing
  for (const [lockId, timer] of expiryTimers.entries()) {
    clearTimeout(timer);
    expiryTimers.delete(lockId);
  }
  fxLocks.clear();
  workspaceLockCount.clear();
}

/** Force-expire a lock by ID (useful in tests that verify expiry behaviour). */
export function __expireLock(lockId: string): void {
  expireLock(lockId);
}

/** Read the current active-lock count for a workspace. */
export function __getWorkspaceLockCount(workspaceId: string): number {
  return workspaceLockCount.get(workspaceId) ?? 0;
}
