import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractorRecord = {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  country: string;
  contractType: string;
  status: string;
  updatedAt: string;
};

type AuditEvent = {
  contractorId: string;
  action: "update";
  changedFields: string[];
  performedBy: string;
  timestamp: string;
};

type UpdateBody = {
  name?: string;
  email?: string;
  country?: string;
  contractType?: string;
  performedBy?: string;
};

const contractors = new Map<string, ContractorRecord>();
const auditLog: AuditEvent[] = [];

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validateCountry(country: string): boolean {
  const trimmed = country.trim();
  return trimmed.length > 0 && trimmed.length <= 100;
}

function validateContractType(contractType: string): boolean {
  const valid = ["fixed", "hourly", "retainer", "project"];
  return valid.includes(contractType.trim().toLowerCase());
}

function validateName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 255;
}

/**
 * PATCH /lancepay/contractors/:id
 * Allow editing mutable contractor fields.
 * Validate each field through the shared schemas helper.
 * Emit an audit event capturing the changed fields.
 */
router.patch(
  "/lancepay/contractors/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const contractor = contractors.get(contractorId);
      if (!contractor) {
        sendError(res, "NOT_FOUND", "Contractor not found", 404);
        return;
      }

      const body = req.body as UpdateBody;
      const performedBy = body.performedBy || "system";
      const now = new Date().toISOString();
      const changedFields: string[] = [];

      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !validateName(body.name)) {
          sendError(res, "INVALID_NAME", "name must be a non-empty string (max 255 chars)", 400);
          return;
        }
        if (body.name.trim() !== contractor.name) {
          contractor.name = body.name.trim();
          changedFields.push("name");
        }
      }

      if (body.email !== undefined) {
        if (typeof body.email !== "string" || !validateEmail(body.email)) {
          sendError(res, "INVALID_EMAIL", "email must be a valid email address", 400);
          return;
        }
        if (body.email.trim() !== contractor.email) {
          contractor.email = body.email.trim();
          changedFields.push("email");
        }
      }

      if (body.country !== undefined) {
        if (typeof body.country !== "string" || !validateCountry(body.country)) {
          sendError(res, "INVALID_COUNTRY", "country must be a non-empty string", 400);
          return;
        }
        if (body.country.trim() !== contractor.country) {
          contractor.country = body.country.trim();
          changedFields.push("country");
        }
      }

      if (body.contractType !== undefined) {
        if (typeof body.contractType !== "string" || !validateContractType(body.contractType)) {
          sendError(
            res,
            "INVALID_CONTRACT_TYPE",
            "contractType must be one of: fixed, hourly, retainer, project",
            400,
          );
          return;
        }
        const normalized = body.contractType.trim().toLowerCase();
        if (normalized !== contractor.contractType) {
          contractor.contractType = normalized;
          changedFields.push("contractType");
        }
      }

      contractor.updatedAt = now;

      if (changedFields.length > 0) {
        auditLog.push({
          contractorId,
          action: "update",
          changedFields,
          performedBy,
          timestamp: now,
        });
      }

      return res.status(200).json({
        success: true,
        data: contractor,
        changed: changedFields.length > 0,
        changedFields,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContractor(c: ContractorRecord): void {
  contractors.set(c.id, { ...c });
}

export function __resetContractors(): void {
  contractors.clear();
  auditLog.length = 0;
}

export function __getContractors(): Map<string, ContractorRecord> {
  return contractors;
}

export function __getAuditLog(): AuditEvent[] {
  return auditLog;
}

export default router;
