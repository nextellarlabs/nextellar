import { Request, Response, NextFunction } from "express";

/**
 * Middleware that enforces a step‑up authentication requirement.
 * The presence of the header `x-step-up-verified: true` indicates the operator
 * has performed a recent step‑up (e.g., OTP, password re‑entry). Adjust the
 * detection logic as needed to integrate with the existing authentication
 * system.
 */
export function requireStepUp(req: Request, res: Response, next: NextFunction) {
  const stepUpHeader = req.headers["x-step-up-verified"] as string | undefined;
  if (stepUpHeader && stepUpHeader.toLowerCase() === "true") {
    return next();
  }
  return res.status(403).json({
    error: "step_up_required",
    message: "Step‑up authentication required for this operation",
  });
}
