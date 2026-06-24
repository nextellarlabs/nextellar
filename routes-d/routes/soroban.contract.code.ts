import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractCodeResponse = {
  contractId: string;
  wasmHash: string;
  sourceCode?: string;
  status: "active" | "archived";
};

const CONTRACT_DB = new Map<string, ContractCodeResponse>([
  [
    "CDLZFC3SYJYDZTKLLNVEGWZHEKU2F4GVWKHK5TCEAEAZUP23WGW3EID2",
    {
      contractId: "CDLZFC3SYJYDZTKLLNVEGWZHEKU2F4GVWKHK5TCEAEAZUP23WGW3EID2",
      wasmHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      sourceCode: "// Sample Soroban contract source",
      status: "active",
    },
  ],
  [
    "CBIELTK6UGFUGJSF3J4ZYQSSFAIS6HB3UDXF2BBZ7BYL6UGHYVHBXI73",
    {
      contractId: "CBIELTK6UGFUGJSF3J4ZYQSSFAIS6HB3UDXF2BBZ7BYL6UGHYVHBXI73",
      wasmHash: "f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1",
      sourceCode: undefined,
      status: "archived",
    },
  ],
]);

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: ContractCodeResponse; expires: number }>();

/**
 * GET /soroban/contract/:id/code
 * Return the wasm hash currently bound to a Soroban contract.
 */
router.get(
  "/soroban/contract/:id/code",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string" || id.trim().length === 0) {
        sendError(res, "INVALID_CONTRACT_ID", "contractId is required", 400);
        return;
      }

      // Validate contract ID format: starts with C, length 56
      if (!id.startsWith("C") || id.length !== 56) {
        sendError(
          res,
          "INVALID_CONTRACT_ID",
          "contractId must be a valid Soroban contract ID (56 chars starting with C)",
          400,
        );
        return;
      }

      const now = Date.now();
      const cached = cache.get(id);
      if (cached && cached.expires > now) {
        return res.status(200).json({
          success: true,
          data: cached.data,
        });
      }

      const contract = CONTRACT_DB.get(id);

      let response: ContractCodeResponse;
      if (contract) {
        response = {
          ...contract,
        };
      } else {
        response = {
          contractId: id,
          wasmHash: "",
          status: "archived",
        };
      }

      cache.set(id, { data: response, expires: now + CACHE_TTL_MS });

      return res.status(200).json({
        success: true,
        data: response,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetContractCode(): void {
  cache.clear();
}

export default router;