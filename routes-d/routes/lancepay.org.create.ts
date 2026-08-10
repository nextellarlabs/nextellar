import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Organization = {
  id: string;
  name: string;
  jurisdiction: string;
  fundingWallet: string;
  ownerId: string;
  status: "active";
};

type CreateOrganizationBody = {
  name: string;
  jurisdiction: string;
  fundingWallet: string;
  ownerId: string;
};

const organizations = new Map<string, Organization>();
const names = new Set<string>();

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isValidWallet(value: string): boolean {
  return /^(G[A-Z2-7]{55}|0x[0-9a-fA-F]{40})$/.test(value.trim());
}

export function __seedOrganization(org: Organization): void {
  organizations.set(org.id, org);
  names.add(normalizeName(org.name));
}

export function __resetOrganizations(): void {
  organizations.clear();
  names.clear();
}

router.post(
  "/lancepay/organizations",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateOrganizationBody;

      if (!body.name || typeof body.name !== "string") {
        sendError(res, "INVALID_NAME", "name is required", 400);
        return;
      }

      const normalizedName = normalizeName(body.name);
      if (!normalizedName) {
        sendError(res, "INVALID_NAME", "name must not be empty", 400);
        return;
      }

      if (names.has(normalizedName)) {
        sendError(res, "NAME_ALREADY_EXISTS", "organization name already exists", 409);
        return;
      }

      if (!body.jurisdiction || typeof body.jurisdiction !== "string") {
        sendError(res, "INVALID_JURISDICTION", "jurisdiction is required", 400);
        return;
      }

      if (!body.fundingWallet || typeof body.fundingWallet !== "string") {
        sendError(res, "INVALID_FUNDING_WALLET", "fundingWallet is required", 400);
        return;
      }

      if (!isValidWallet(body.fundingWallet)) {
        sendError(
          res,
          "INVALID_FUNDING_WALLET",
          "fundingWallet must be a valid Stellar or Ethereum address",
          400,
        );
        return;
      }

      if (!body.ownerId || typeof body.ownerId !== "string") {
        sendError(res, "INVALID_OWNER_ID", "ownerId is required", 400);
        return;
      }

      const organization: Organization = {
        id: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: body.name.trim(),
        jurisdiction: body.jurisdiction.trim(),
        fundingWallet: body.fundingWallet.trim(),
        ownerId: body.ownerId.trim(),
        status: "active",
      };

      organizations.set(organization.id, organization);
      names.add(normalizedName);

      return res.status(201).json({ success: true, data: organization });
    } catch (error) {
      return next(error);
    }
  },
);

export function __getOrganizations(): Map<string, Organization> {
  return organizations;
}

export default router;
