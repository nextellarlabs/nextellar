import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { sendError } from "../lib/response.js";

const router = Router();

export type Invite = {
  id: string;
  orgId: string;
  email: string;
  role: string;
  token: string;
  inviteUrl: string;
  expiresAt: number;
  used: boolean;
  invitedBy: string;
};

const invitesStore = new Map<string, Invite>();

router.post("/lancepay/organizations/:id/members/invite", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.id?.trim();
    if (!orgId) {
      sendError(res, "INVALID_ORG_ID", "Organization ID is required", 400);
      return;
    }

    const callerRole = (req.headers["x-caller-role"] as string) || req.body?.callerRole;
    const callerId = (req.headers["x-caller-id"] as string) || req.body?.callerId;

    if (!callerId || !callerRole || (callerRole !== "owner" && callerRole !== "admin")) {
      sendError(res, "UNAUTHORIZED", "Only owner or admin can issue member invites", 403);
      return;
    }

    const { email, role = "member", ttlSeconds = 86400 } = req.body ?? {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      sendError(res, "INVALID_EMAIL", "Valid email is required", 400);
      return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const inviteId = `inv_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const inviteUrl = `https://lancepay.app/invite/accept?token=${token}&org=${orgId}`;

    const invite: Invite = {
      id: inviteId,
      orgId,
      email: email.trim().toLowerCase(),
      role,
      token,
      inviteUrl,
      expiresAt,
      used: false,
      invitedBy: callerId,
    };

    invitesStore.set(token, invite);

    return res.status(201).json({
      success: true,
      data: invite,
    });
  } catch (err) {
    return next(err);
  }
});

// Helper route to verify/accept invite token
router.get("/lancepay/organizations/invites/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.query.token as string | undefined;
    if (!token) {
      sendError(res, "INVALID_TOKEN", "Invite token is required", 400);
      return;
    }

    const invite = invitesStore.get(token);
    if (!invite) {
      sendError(res, "NOT_FOUND", "Invite token not found", 404);
      return;
    }

    if (invite.used) {
      sendError(res, "ALREADY_USED", "Invite token has already been used", 400);
      return;
    }

    if (Date.now() > invite.expiresAt) {
      sendError(res, "EXPIRED", "Invite link has expired", 400);
      return;
    }

    return res.status(200).json({ success: true, data: invite });
  } catch (err) {
    return next(err);
  }
});

export function __seedInvite(invite: Invite) {
  invitesStore.set(invite.token, invite);
}

export function __getInvite(token: string): Invite | undefined {
  return invitesStore.get(token);
}

export function __resetInviteStore() {
  invitesStore.clear();
}

export default router;
