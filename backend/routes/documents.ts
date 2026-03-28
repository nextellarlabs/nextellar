import { Router, Request, Response, NextFunction } from "express";

const router = Router();

/**
 * Allowed MIME types for document uploads, validated from file magic bytes.
 */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Known file magic byte signatures.
 * Each entry maps a MIME type to its expected header bytes.
 */
const MAGIC_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] }, // .PNG
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] }, // JFIF/EXIF
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (WebP)
];

/**
 * Detects MIME type from the first bytes of a buffer using magic byte
 * signatures. Returns null if no known signature matches.
 */
export function detectMimeType(buffer: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    const matches = sig.bytes.every((byte, i) => buffer[i] === byte);
    if (matches) return sig.mime;
  }
  return null;
}

/**
 * POST /documents/upload
 * Accepts a raw file buffer and validates the MIME type from magic bytes.
 * Rejects disallowed types with 415 Unsupported Media Type.
 *
 * In production this would use multer or a similar middleware for
 * multipart form parsing. Here we read the raw body for simplicity.
 */
router.post(
  "/documents/upload",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fileBuffer = await getRawBody(req);

      if (!fileBuffer || fileBuffer.length === 0) {
        res
          .status(400)
          .json({ success: false, message: "No file data received." });
        return;
      }

      const detectedMime = detectMimeType(fileBuffer);

      if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
        res.status(415).json({
          success: false,
          message:
            "Unsupported file type. Only PDF, PNG, JPEG, GIF, and WebP files are allowed.",
        });
        return;
      }

      const result = await saveDocument(fileBuffer, detectedMime);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stubs - swap out for your actual implementation
// ---------------------------------------------------------------------------
export async function getRawBody(req: Request): Promise<Buffer> {
  // In production, use multer or busboy to parse multipart data.
  // Here we return req.body as a buffer for testing.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return Buffer.alloc(0);
}

export async function saveDocument(
  _buffer: Buffer,
  _mimeType: string,
): Promise<{ id: string; mimeType: string }> {
  return { id: "doc-001", mimeType: _mimeType };
}
