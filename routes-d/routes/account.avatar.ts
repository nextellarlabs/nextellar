import { Router, Request, Response, NextFunction } from "express";
import { IncomingForm, Fields, Files } from "formidable";
import fs from "fs";
import { sendError } from "../lib/response.js";
import {
  processAvatar,
  AVATAR_SIZES,
  MAX_UPLOAD_BYTES,
  type AvatarSize,
} from "../lib/imageProcessor.js";

const router = Router();

// ---------------------------------------------------------------------------
// In-memory avatar store (mock database)
// Each user can have one set of variants keyed by canonical size.
// ---------------------------------------------------------------------------

type AvatarVariant = {
  size: AvatarSize;
  data: Buffer;
  mimeType: "image/png";
  uploadedAt: string;
};

type UserAvatars = {
  userId: string;
  variants: Map<AvatarSize, AvatarVariant>;
  uploadedAt: string;
};

const avatarStore = new Map<string, UserAvatars>();

// ---------------------------------------------------------------------------
// POST /account/avatar  – upload & process
// ---------------------------------------------------------------------------

/**
 * POST /account/avatar
 *
 * Accepts a multipart/form-data upload with a single field "avatar".
 * Supported types: image/png, image/jpeg.
 * Max size: 5 MB.
 *
 * Strips EXIF data and stores resized variants at 32, 64, 128, 256 px.
 *
 * Requires header: x-user-id
 *
 * Response 201:
 *   { success: true, data: { userId, sizes: [32, 64, 128, 256], uploadedAt } }
 */
router.post(
  "/account/avatar",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      // Parse multipart form
      const form = new IncomingForm({
        maxFileSize: MAX_UPLOAD_BYTES,
        allowEmptyFiles: false,
        multiples: false,
      });

      let fileBuffer: Buffer = Buffer.alloc(0);
      let uploadedMime: string = "";

      try {
        await new Promise<void>((resolve, reject) => {
          form.parse(req, (err: unknown, _fields: Fields, files: Files) => {
            if (err) {
              return reject(err);
            }

            // formidable v3+ returns arrays
            const raw = files["avatar"];
            const file = Array.isArray(raw) ? raw[0] : raw;

            if (!file) {
              return reject(new Error("NO_FILE"));
            }

            uploadedMime = file.mimetype ?? "";
            const filePath = file.filepath;

            try {
              fileBuffer = fs.readFileSync(filePath);
              fs.unlinkSync(filePath); // clean up temp file
            } catch (readErr) {
              return reject(readErr);
            }

            resolve();
          });
        });
      } catch (parseErr: unknown) {
        if (parseErr instanceof Error) {
          if (parseErr.message === "NO_FILE") {
            sendError(res, "NO_FILE", "Field 'avatar' is required", 400);
            return;
          }
          if (
            parseErr.message.includes("maxFileSize") ||
            parseErr.message.includes("too large") ||
            parseErr.message.includes("size")
          ) {
            sendError(
              res,
              "FILE_TOO_LARGE",
              `File exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
              413,
            );
            return;
          }
        }
        return next(parseErr);
      }

      // Validate MIME via content sniffing (don't trust client header)
      let processed;
      try {
        processed = await processAvatar(fileBuffer!);
      } catch (procErr: unknown) {
        if (procErr instanceof Error) {
          if (procErr.message.includes("Unsupported image type")) {
            sendError(
              res,
              "UNSUPPORTED_TYPE",
              procErr.message,
              415,
            );
            return;
          }
          if (procErr.message.includes("maximum allowed size")) {
            sendError(res, "FILE_TOO_LARGE", procErr.message, 413);
            return;
          }
          if (procErr.message.includes("PNG decode error") || procErr.message.includes("Not a valid JPEG")) {
            sendError(res, "INVALID_IMAGE", "The uploaded file could not be decoded as a valid image", 422);
            return;
          }
        }
        return next(procErr);
      }

      const now = new Date().toISOString();
      const variantMap = new Map<AvatarSize, AvatarVariant>();

      for (const v of processed.variants) {
        variantMap.set(v.size, {
          size: v.size,
          data: v.data,
          mimeType: v.mimeType,
          uploadedAt: now,
        });
      }

      avatarStore.set(userId, {
        userId,
        variants: variantMap,
        uploadedAt: now,
      });

      return res.status(201).json({
        success: true,
        data: {
          userId,
          sizes: [...AVATAR_SIZES],
          uploadedAt: now,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /account/avatar  – fetch avatar variant
// ---------------------------------------------------------------------------

/**
 * GET /account/avatar?size=<32|64|128|256>
 *
 * Returns the PNG image for the requested size.
 * Defaults to size=128 if not specified.
 *
 * Requires header: x-user-id
 *
 * Response 200: image/png binary
 */
router.get(
  "/account/avatar",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const sizeParam = req.query["size"];
      const sizeNum = sizeParam !== undefined ? Number(sizeParam) : 128;

      if (
        !AVATAR_SIZES.includes(sizeNum as AvatarSize)
      ) {
        sendError(
          res,
          "INVALID_SIZE",
          `size must be one of ${AVATAR_SIZES.join(", ")}`,
          400,
        );
        return;
      }

      const size = sizeNum as AvatarSize;

      const userAvatars = avatarStore.get(userId);
      if (!userAvatars) {
        sendError(res, "AVATAR_NOT_FOUND", "No avatar uploaded for this user", 404);
        return;
      }

      const variant = userAvatars.variants.get(size);
      if (!variant) {
        sendError(
          res,
          "AVATAR_NOT_FOUND",
          `Avatar variant at size ${size} not found`,
          404,
        );
        return;
      }

      res.set("Content-Type", "image/png");
      res.set("Content-Length", String(variant.data.length));
      res.set("Cache-Control", "public, max-age=86400");
      return res.status(200).send(variant.data);
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /account/avatar  – remove avatar
// ---------------------------------------------------------------------------

/**
 * DELETE /account/avatar
 *
 * Removes all avatar variants for the authenticated user.
 *
 * Requires header: x-user-id
 *
 * Response 200: { success: true }
 */
router.delete(
  "/account/avatar",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      if (!avatarStore.has(userId)) {
        sendError(res, "AVATAR_NOT_FOUND", "No avatar found for this user", 404);
        return;
      }

      avatarStore.delete(userId);
      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Test helpers (not exported in production builds but harmless)
// ---------------------------------------------------------------------------

export function __resetAvatarStore(): void {
  avatarStore.clear();
}

export function __getAvatarStore(): Map<string, UserAvatars> {
  return avatarStore;
}

export function __seedAvatar(
  userId: string,
  variants: Array<{ size: AvatarSize; data: Buffer }>,
): void {
  const now = new Date().toISOString();
  const variantMap = new Map<AvatarSize, AvatarVariant>();
  for (const v of variants) {
    variantMap.set(v.size, {
      size: v.size,
      data: v.data,
      mimeType: "image/png",
      uploadedAt: now,
    });
  }
  avatarStore.set(userId, { userId, variants: variantMap, uploadedAt: now });
}

export default router;
