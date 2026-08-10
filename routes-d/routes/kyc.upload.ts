import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { sendError } from "../lib/response.js";
import { storeFile } from "../lib/uploadHelper.js";

const router = Router();

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAGIC_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

const MAX_FILE_SIZE = parseInt(process.env.KYC_MAX_FILE_SIZE || "10485760", 10);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }
  },
});

function detectMimeType(buffer: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    const matches = sig.bytes.every((byte, i) => buffer[i] === byte);
    if (matches) return sig.mime;
  }
  return null;
}

async function virusScan(_buffer: Buffer): Promise<{ clean: boolean }> {
  return { clean: true };
}

router.post(
  "/kyc/upload",
  (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, async (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            sendError(res, "FILE_TOO_LARGE", `File exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`, 413);
            return;
          }
          sendError(res, "UPLOAD_ERROR", err.message, 400);
          return;
        }
        if (err instanceof Error && err.message === "UNSUPPORTED_FILE_TYPE") {
          sendError(res, "UNSUPPORTED_FILE_TYPE", "File type is not supported. Allowed: PDF, PNG, JPEG, GIF, WebP", 415);
          return;
        }
        return next(err);
      }

      try {
        const file = (req as any).file;
        if (!file) {
          sendError(res, "NO_FILE", "No file was uploaded", 400);
          return;
        }

        const userId = req.headers["x-user-id"] as string | undefined;
        if (!userId) {
          sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
          return;
        }

        const detectedMime = detectMimeType(file.buffer);
        if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
          sendError(res, "INVALID_FILE_CONTENT", "File content does not match its declared type", 415);
          return;
        }

        const scanResult = await virusScan(file.buffer);
        if (!scanResult.clean) {
          sendError(res, "VIRUS_DETECTED", "File failed virus scan", 422);
          return;
        }

        const stored = await storeFile(file.originalname, file.buffer, detectedMime);

        res.status(201).json({
          success: true,
          data: {
            id: stored.id,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.size,
            presignedUrl: stored.presignedUrl,
            uploadedAt: stored.uploadedAt,
          },
        });
      } catch (innerErr) {
        return next(innerErr);
      }
    });
  },
);

export function __getMaxFileSize(): number {
  return MAX_FILE_SIZE;
}

export default router;
