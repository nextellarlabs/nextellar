import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type UploadWasmBody = {
  wasm: string; // base64 encoded wasm bytecode
};

// Configurable size limit for WASM uploads (default: 10MB)
const MAX_WASM_SIZE = parseInt(process.env.MAX_WASM_SIZE || "10485760", 10);

/**
 * Validates that the provided base64 string decodes to valid WASM bytecode.
 * WASM modules start with magic number 0x00 0x61 0x73 0x6d ('\0asm') followed by version 0x01 0x00 0x00 0x00.
 */
function validateWasmBytecode(base64String: string): { valid: boolean; error?: string } {
  if (!base64String || typeof base64String !== "string") {
    return { valid: false, error: "WASM bytecode is required" };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64String, "base64");
  } catch {
    return { valid: false, error: "WASM bytecode must be valid base64" };
  }

  if (buffer.length < 8) {
    return { valid: false, error: "WASM bytecode too short: missing header" };
  }

  // Check WASM magic number (0x00 0x61 0x73 0x6d = '\0asm')
  const magic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
  if (!buffer.subarray(0, 4).equals(magic)) {
    return { valid: false, error: "Invalid WASM magic number" };
  }

  // Check version (0x01 0x00 0x00 0x00 little-endian uint32 = 1)
  const version = buffer.readUInt32LE(4);
  if (version !== 1) {
    return { valid: false, error: `Unsupported WASM version: ${version}` };
  }

  return { valid: true };
}

/**
 * POST /soroban/contract/upload-wasm
 * Upload a Soroban WASM bundle and return the resulting hash.
 */
router.post(
  "/soroban/contract/upload-wasm",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as UploadWasmBody;

      if (!body.wasm || typeof body.wasm !== "string") {
        sendError(res, "INVALID_WASM", "wasm bytecode is required and must be a base64 string", 400);
        return;
      }

      // Decode to check size
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.wasm, "base64");
      } catch {
        sendError(res, "INVALID_WASM", "WASM bytecode must be valid base64", 400);
        return;
      }

      if (buffer.length > MAX_WASM_SIZE) {
        sendError(
          res,
          "WASM_TOO_LARGE",
          `WASM bytecode exceeds maximum allowed size of ${MAX_WASM_SIZE} bytes`,
          413,
        );
        return;
      }

      // Sanity check wasm format
      const validation = validateWasmBytecode(body.wasm);
      if (!validation.valid) {
        sendError(res, "INVALID_WASM", validation.error || "Malformed WASM bytecode", 400);
        return;
      }

      // Compute hash (mock)
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");

      res.status(200).json({
        success: true,
        data: {
          hash,
          size: buffer.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getMaxWasmSize(): number {
  return MAX_WASM_SIZE;
}

export function __validateWasmBytecode(base64String: string): { valid: boolean; error?: string } {
  return validateWasmBytecode(base64String);
}

export default router;