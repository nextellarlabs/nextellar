import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import * as StellarSDK from "@stellar/stellar-sdk";

const router = Router();

type CachedABI = {
  abi: unknown;
  timestamp: number;
};

const abiCache = new Map<string, CachedABI>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /soroban/contract/:id/abi
 * Return the decoded ABI for a Soroban contract.
 */
router.get(
  "/soroban/contract/:id/abi",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string" || id.trim().length === 0) {
        sendError(res, "INVALID_CONTRACT_ID", "Contract ID is required and must be a non-empty string", 400);
        return;
      }

      // Check cache
      const cached = abiCache.get(id);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.status(200).json({
          success: true,
          data: cached.abi,
          cached: true,
        });
      }

      // In a real implementation, this would fetch from Stellar Horizon
      // For now, we return a mock response that demonstrates the structure
      try {
        // Validate contract ID format (Soroban contracts start with 'C')
        if (!id.startsWith("C")) {
          sendError(res, "INVALID_CONTRACT_ID", "Contract ID must start with 'C'", 400);
          return;
        }

        // Mock ABI structure for demonstration
        const mockABI = {
          functions: [
            {
              name: "initialize",
              inputs: [
                {
                  name: "admin",
                  type: "Address",
                },
              ],
              outputs: [],
            },
          ],
          metadata: {
            spec_version: "20240101",
          },
        };

        // Cache the result
        abiCache.set(id, {
          abi: mockABI,
          timestamp: Date.now(),
        });

        return res.status(200).json({
          success: true,
          data: mockABI,
          cached: false,
        });
      } catch (error) {
        sendError(
          res,
          "ABI_LOOKUP_FAILED",
          error instanceof Error ? error.message : "Failed to lookup contract ABI",
          500,
        );
        return;
      }
    } catch (err) {
      return next(err);
    }
  },
);

export function __clearABICache(): void {
  abiCache.clear();
}

export function __getABICache(): Map<string, CachedABI> {
  return abiCache;
}

export default router;
