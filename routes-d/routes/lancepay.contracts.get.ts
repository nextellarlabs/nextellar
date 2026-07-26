import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import { __getContract } from "./lancepay.contracts.amend.js";

const router = Router();

/**
 * GET /lancepay/contracts/:id
 * Return a single contract with its current version, status, and amendment history.
 * Accessible to members of the owning workspace (via x-workspace-id header)
 * or the contractor party (via x-caller-id header).
 */
router.get(
  "/lancepay/contracts/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractId = req.params.id?.trim();
      if (!contractId) {
        sendError(res, "INVALID_CONTRACT_ID", "contractId is required", 400);
        return;
      }

      const contract = __getContract(contractId);
      if (!contract) {
        sendError(res, "NOT_FOUND", "Contract not found", 404);
        return;
      }

      // Authorization: workspace member or contractor
      const workspaceId = req.headers["x-workspace-id"] as string | undefined;
      const callerId = req.headers["x-caller-id"] as string | undefined;

      if (!workspaceId && !callerId) {
        sendError(res, "MISSING_AUTH", "x-workspace-id or x-caller-id header is required", 401);
        return;
      }

      const isWorkspaceMember = workspaceId && workspaceId === contract.workspaceId;
      const isContractor = callerId && callerId === contract.contractorId;

      if (!isWorkspaceMember && !isContractor) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: you are not authorized to view this contract",
          403,
        );
        return;
      }

      // Return the full contract record (including history)
      return res.status(200).json({ success: true, data: contract });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
