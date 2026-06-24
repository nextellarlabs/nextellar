import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import crypto from "crypto";

const router = Router();

const ONBOARDING_STEPS = ["personal_info", "kyc", "wallet_link", "tax_form"] as const;
type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

type StepStatus = "pending" | "completed" | "skipped";

type SessionStep = {
  step: OnboardingStep;
  status: StepStatus;
  completedAt?: string;
};

type OnboardingSession = {
  id: string;
  contractorId: string;
  sessionToken: string;
  steps: SessionStep[];
  currentStep: OnboardingStep | "complete";
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
};

type StartBody  = { contractorId: string };
type ResumeBody = { sessionToken: string; completeStep?: OnboardingStep };

// In-memory store
const sessions = new Map<string, OnboardingSession>();              // sessionId -> session
const contractorSession = new Map<string, string>();               // contractorId -> sessionId
const tokenIndex = new Map<string, string>();                      // sessionToken -> sessionId

function nextPendingStep(steps: SessionStep[]): OnboardingStep | "complete" {
  const next = steps.find((s) => s.status === "pending");
  return next ? next.step : "complete";
}

/**
 * POST /lancepay/contractors/:id/onboarding
 * Start a new onboarding session or resume an existing one.
 * Body: { contractorId } to start; { sessionToken, completeStep? } to resume.
 */
router.post(
  "/lancepay/contractors/:id/onboarding",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const body = req.body as StartBody & ResumeBody;
      const now = new Date().toISOString();

      // Resume flow — sessionToken provided
      if (body.sessionToken) {
        const sessionId = tokenIndex.get(body.sessionToken);
        if (!sessionId) {
          sendError(res, "INVALID_SESSION_TOKEN", "Session token not found or expired", 404);
          return;
        }

        const session = sessions.get(sessionId)!;

        if (session.contractorId !== contractorId) {
          sendError(res, "SESSION_MISMATCH", "Session does not belong to this contractor", 403);
          return;
        }

        if (session.isComplete) {
          return res.status(200).json({ success: true, data: session, resumed: true });
        }

        // Optionally mark a step complete
        if (body.completeStep) {
          const step = session.steps.find((s) => s.step === body.completeStep);
          if (!step) {
            sendError(res, "INVALID_STEP", `Unknown step: ${body.completeStep}`, 400);
            return;
          }
          step.status = "completed";
          step.completedAt = now;
        }

        session.currentStep = nextPendingStep(session.steps);
        session.isComplete  = session.currentStep === "complete";
        session.updatedAt   = now;

        return res.status(200).json({ success: true, data: session, resumed: true });
      }

      // Start flow — new or existing session
      const existingId = contractorSession.get(contractorId);
      if (existingId) {
        const existing = sessions.get(existingId)!;
        if (!existing.isComplete) {
          return res.status(200).json({ success: true, data: existing, resumed: true });
        }
        // Completed session exists — start fresh
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      const sessionId    = `os-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const steps: SessionStep[] = ONBOARDING_STEPS.map((s) => ({
        step: s,
        status: "pending",
      }));

      const session: OnboardingSession = {
        id: sessionId,
        contractorId,
        sessionToken,
        steps,
        currentStep: ONBOARDING_STEPS[0],
        isComplete: false,
        createdAt: now,
        updatedAt: now,
      };

      sessions.set(sessionId, session);
      contractorSession.set(contractorId, sessionId);
      tokenIndex.set(sessionToken, sessionId);

      return res.status(201).json({ success: true, data: session });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getSessions(): Map<string, OnboardingSession> {
  return sessions;
}

export function __resetSessions(): void {
  sessions.clear();
  contractorSession.clear();
  tokenIndex.clear();
}

export function __seedSession(session: OnboardingSession): void {
  sessions.set(session.id, session);
  contractorSession.set(session.contractorId, session.id);
  tokenIndex.set(session.sessionToken, session.id);
}

export default router;
