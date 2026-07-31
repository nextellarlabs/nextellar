import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export type Member = {
  memberId: string;
  orgId: string;
  role: MemberRole;
};

export type AuditEvent = {
  id: string;
  orgId: string;
  memberId: string;
  previousRole: MemberRole;
  newRole: MemberRole;
  updatedBy: string;
  timestamp: string;
};

const membersStore = new Map<string, Member>();
const auditEvents: AuditEvent[] = [];

const VALID_ROLES: MemberRole[] = ["owner", "admin", "member", "viewer"];

router.post("/lancepay/organizations/:id/members/role", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.id?.trim();
    if (!orgId) {
      sendError(res, "INVALID_ORG_ID", "Organization ID is required", 400);
      return;
    }

    const callerRole = (req.headers["x-caller-role"] as string) || req.body?.callerRole;
    const callerId = (req.headers["x-caller-id"] as string) || req.body?.callerId;

    if (!callerId || !callerRole || (callerRole !== "owner" && callerRole !== "admin")) {
      sendError(res, "UNAUTHORIZED", "Caller must be an owner or admin", 403);
      return;
    }

    const { memberId, newRole } = req.body ?? {};

    if (!memberId || typeof memberId !== "string" || !newRole || !VALID_ROLES.includes(newRole)) {
      sendError(res, "INVALID_ROLE", "Valid memberId and newRole are required", 400);
      return;
    }

    const key = `${orgId}:${memberId}`;
    let member = membersStore.get(key);

    if (!member) {
      member = { memberId, orgId, role: "member" };
    }

    const previousRole = member.role;
    if (previousRole === newRole) {
      return res.status(200).json({
        success: true,
        data: { memberId, orgId, role: newRole },
        message: "Role is already set to target role",
      });
    }

    member.role = newRole;
    membersStore.set(key, member);

    const auditEvent: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      orgId,
      memberId,
      previousRole,
      newRole,
      updatedBy: callerId,
      timestamp: new Date().toISOString(),
    };
    auditEvents.push(auditEvent);

    return res.status(200).json({
      success: true,
      data: {
        memberId,
        orgId,
        previousRole,
        newRole,
      },
      auditEvent,
    });
  } catch (err) {
    return next(err);
  }
});

export function __seedMember(m: Member) {
  membersStore.set(`${m.orgId}:${m.memberId}`, m);
}

export function __getMember(orgId: string, memberId: string): Member | undefined {
  return membersStore.get(`${orgId}:${memberId}`);
}

export function __getAuditEvents(): AuditEvent[] {
  return auditEvents;
}

export function __resetRoleStore() {
  membersStore.clear();
  auditEvents.length = 0;
}

export default router;
