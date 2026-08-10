import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

export type UserOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  isActive: boolean;
};

const userOrgsStore = new Map<string, UserOrganization[]>();

router.get("/lancepay/organizations", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req.headers["x-user-id"] as string) || (req.query.userId as string);
    const activeOrgId = (req.headers["x-active-org-id"] as string) || (req.query.activeOrgId as string);

    if (!userId || typeof userId !== "string" || !userId.trim()) {
      sendError(res, "UNAUTHORIZED", "User identity required (x-user-id header or query)", 401);
      return;
    }

    const orgs = userOrgsStore.get(userId.trim()) ?? [];

    const formattedOrgs = orgs.map((org, index) => ({
      ...org,
      isActive: activeOrgId ? org.id === activeOrgId : index === 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        organizations: formattedOrgs,
        total: formattedOrgs.length,
        activeOrgId: formattedOrgs.find((o) => o.isActive)?.id ?? null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __seedUserOrganizations(userId: string, orgs: UserOrganization[]) {
  userOrgsStore.set(userId, orgs);
}

export function __resetUserOrganizations() {
  userOrgsStore.clear();
}

export default router;
