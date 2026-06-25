import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type RecoveryInitBody = {
  walletId: string;
  guardians: string[];
  threshold: number;
};

type RecoveryFlow = {
  id: string;
  userId: string;
  walletId: string;
  guardians: string[];
  threshold: number;
  createdAt: string;
};

type Notification = {
  guardian: string;
  recoveryId: string;
  walletId: string;
};

const recoveryFlows = new Map<string, RecoveryFlow>();
const guardianReachability = new Map<string, boolean>();
const sentNotifications: Notification[] = [];

function validateGuardians(guardians: unknown): string | null {
  if (!Array.isArray(guardians) || guardians.length === 0) {
    return "guardians must be a non-empty array";
  }

  const normalized = guardians.map((guardian) => (
    typeof guardian === "string" ? guardian.trim().toLowerCase() : ""
  ));

  if (normalized.some((guardian) => guardian.length === 0)) {
    return "guardians must contain non-empty identifiers";
  }

  if (new Set(normalized).size !== normalized.length) {
    return "guardians must be unique";
  }

  return null;
}

function validateThreshold(threshold: unknown, guardianCount: number): string | null {
  if (typeof threshold !== "number" || !Number.isInteger(threshold)) {
    return "threshold must be an integer";
  }

  if (threshold < 1 || threshold > guardianCount) {
    return "threshold must be between 1 and the number of guardians";
  }

  return null;
}

function dispatchGuardianNotification(guardian: string, recoveryId: string, walletId: string): void {
  if (guardianReachability.get(guardian) === false) {
    throw new Error(`guardian ${guardian} is unreachable`);
  }

  sentNotifications.push({ guardian, recoveryId, walletId });
}

router.post("/wallets/recovery/init", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const body = req.body as RecoveryInitBody;

    if (!body.walletId || typeof body.walletId !== "string") {
      sendError(res, "MISSING_WALLET", "walletId is required", 400);
      return;
    }

    const guardiansError = validateGuardians(body.guardians);
    if (guardiansError) {
      sendError(res, "INVALID_GUARDIANS", guardiansError, 400);
      return;
    }

    const thresholdError = validateThreshold(body.threshold, body.guardians.length);
    if (thresholdError) {
      sendError(res, "INVALID_THRESHOLD", thresholdError, 400);
      return;
    }

    const recoveryId = `recovery_${Date.now()}_${recoveryFlows.size + 1}`;

    try {
      body.guardians.forEach((guardian) => {
        dispatchGuardianNotification(guardian, recoveryId, body.walletId);
      });
    } catch (err) {
      const error = err as Error;
      sendError(res, "GUARDIAN_UNREACHABLE", error.message, 424);
      return;
    }

    const flow: RecoveryFlow = {
      id: recoveryId,
      userId,
      walletId: body.walletId,
      guardians: body.guardians,
      threshold: body.threshold,
      createdAt: new Date().toISOString(),
    };

    recoveryFlows.set(recoveryId, flow);

    return res.status(201).json({
      success: true,
      data: {
        recoveryId,
        walletId: flow.walletId,
        guardiansNotified: sentNotifications.filter((notification) => notification.recoveryId === recoveryId).length,
        threshold: flow.threshold,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __setGuardianReachable(guardian: string, reachable: boolean): void {
  guardianReachability.set(guardian, reachable);
}

export function __getRecoveryNotifications(): Notification[] {
  return sentNotifications;
}

export function __resetRecoveryInit(): void {
  recoveryFlows.clear();
  guardianReachability.clear();
  sentNotifications.length = 0;
}

export default router;
