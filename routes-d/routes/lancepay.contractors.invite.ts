import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import crypto from "crypto";

const router = Router();

const INVITE_TTL_MS  = 72 * 60 * 60 * 1000; // 72 hours
const RESEND_COOLDOWN_MS = 60 * 60 * 1000;   // 1 hour between resends

type InviteStatus = "pending" | "accepted" | "expired";

type ContractorInvite = {
  id: string;
  contractorId: string;
  workspaceId: string;
  token: string;
  link: string;
  email?: string;
  phone?: string;
  status: InviteStatus;
  expiresAt: string;
  lastSentAt: string;
  createdAt: string;
};

const invites = new Map<string, ContractorInvite>();    // inviteId -> invite
const contractorLatestInvite = new Map<string, string>(); // contractorId -> inviteId

type InviteBody = {
  workspaceId: string;
  email?: string;
  phone?: string;
};

function generateSignedLink(token: string): string {
  const sig = crypto.createHmac("sha256", "SECRET").update(token).digest("hex").slice(0, 16);
  return `https://app.nextellar.com/invite/${token}?sig=${sig}`;
}

/**
 * POST /lancepay/contractors/:id/invite
 * Issue or resend a single-use signed invite link to a contractor.
 */
router.post(
  "/lancepay/contractors/:id/invite",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const body = req.body as InviteBody;

      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!body.email && !body.phone) {
        sendError(res, "MISSING_CONTACT", "At least one of email or phone is required", 400);
        return;
      }

      if (body.email && typeof body.email !== "string") {
        sendError(res, "INVALID_EMAIL", "email must be a string", 400);
        return;
      }

      if (body.phone && typeof body.phone !== "string") {
        sendError(res, "INVALID_PHONE", "phone must be a string", 400);
        return;
      }

      const now = Date.now();

      // Resend throttling — check if an active invite was sent recently
      const existingId = contractorLatestInvite.get(contractorId);
      if (existingId) {
        const existing = invites.get(existingId);
        if (existing && existing.status === "pending") {
          const msSinceLastSend = now - new Date(existing.lastSentAt).getTime();
          if (msSinceLastSend < RESEND_COOLDOWN_MS) {
            const waitMin = Math.ceil((RESEND_COOLDOWN_MS - msSinceLastSend) / 60_000);
            sendError(
              res,
              "RESEND_TOO_SOON",
              `Invite was sent recently. Please wait ${waitMin}m before resending.`,
              429,
            );
            return;
          }
          // Resend: update lastSentAt and return existing invite
          existing.lastSentAt = new Date(now).toISOString();
          return res.status(200).json({ success: true, data: existing, resent: true });
        }
      }

      // Create new single-use token
      const token   = crypto.randomBytes(32).toString("hex");
      const inviteId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const invite: ContractorInvite = {
        id: inviteId,
        contractorId,
        workspaceId: body.workspaceId,
        token,
        link: generateSignedLink(token),
        email: body.email,
        phone: body.phone,
        status: "pending",
        expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
        lastSentAt: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
      };

      invites.set(inviteId, invite);
      contractorLatestInvite.set(contractorId, inviteId);

      // In production: dispatch via email/SMS notification helpers here

      return res.status(201).json({ success: true, data: invite });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getInvites(): Map<string, ContractorInvite> {
  return invites;
}

export function __resetInvites(): void {
  invites.clear();
  contractorLatestInvite.clear();
}

export function __seedInvite(invite: ContractorInvite): void {
  invites.set(invite.id, invite);
  contractorLatestInvite.set(invite.contractorId, invite.id);
}

export default router;
