import { Router, Request, Response, NextFunction } from "express";
import { createHash, randomBytes } from "crypto";
import { sendError } from "../lib/response.js";

const router = Router();

export type ApiKey = {
  id: string;
  userId: string;
  prefix: string;
  hashedKey: string;
  label: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
};

type CreateKeyBody = {
  label?: string;
  scopes?: string[];
  expiresInDays?: number;
};

type RotateKeyBody = {
  keyId?: string;
};

type RevokeKeyBody = {
  keyId?: string;
};

const apiKeys = new Map<string, ApiKey>();

function generateRawKey(): string {
  return "nx_" + randomBytes(32).toString("hex");
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function maskKey(rawKey: string): string {
  if (rawKey.length <= 10) return rawKey.slice(0, 4) + "****";
  return rawKey.slice(0, 7) + "****" + rawKey.slice(-4);
}

function stripHash(key: ApiKey): Omit<ApiKey, "hashedKey"> {
  const { hashedKey: _, ...rest } = key;
  return rest;
}

function isExpired(key: ApiKey): boolean {
  if (!key.expiresAt) return false;
  return new Date(key.expiresAt) < new Date();
}

function isRevoked(key: ApiKey): boolean {
  return key.revokedAt !== null;
}

/**
 * POST /api-keys
 * Create a new API key for the authenticated user.
 * Returns the raw key exactly once; only the hash is stored.
 */
router.post(
  "/api-keys",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        req.body?.userId ||
        (req.headers["x-user-id"] as string | undefined);

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const body: CreateKeyBody = req.body ?? {};
      const label =
        typeof body.label === "string" && body.label.trim().length > 0
          ? body.label.trim()
          : "Unnamed key";

      const scopes: string[] = Array.isArray(body.scopes)
        ? body.scopes.filter(
            (s): s is string => typeof s === "string" && s.trim().length > 0,
          )
        : [];

      let expiresAt: string | null = null;
      if (typeof body.expiresInDays === "number" && body.expiresInDays > 0) {
        const ms = body.expiresInDays * 24 * 60 * 60 * 1000;
        expiresAt = new Date(Date.now() + ms).toISOString();
      }

      const rawKey = generateRawKey();
      const id = "ak_" + randomBytes(12).toString("hex");
      const prefix = rawKey.slice(0, 7);

      const apiKey: ApiKey = {
        id,
        userId,
        prefix,
        hashedKey: hashKey(rawKey),
        label,
        scopes,
        expiresAt,
        createdAt: new Date().toISOString(),
        rotatedAt: null,
        revokedAt: null,
      };

      apiKeys.set(id, apiKey);

      return res.status(201).json({
        success: true,
        data: {
          ...stripHash(apiKey),
          rawKey,
          rawKeyPreview: maskKey(rawKey),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * GET /api-keys
 * List API keys belonging to the calling user.
 * Raw keys are never returned; only metadata is shown.
 */
router.get(
  "/api-keys",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        (req.headers["x-user-id"] as string | undefined) ||
        req.body?.userId;

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const includeAll =
        (req.query.includeAll as string) === "true";

      let userKeys = Array.from(apiKeys.values()).filter(
        (k) => k.userId === userId,
      );

      if (!includeAll) {
        userKeys = userKeys.filter((k) => !isRevoked(k));
      }

      const listed = userKeys.map((k) => ({
        ...stripHash(k),
        expired: isExpired(k),
      }));

      return res.status(200).json({
        success: true,
        data: listed,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * POST /api-keys/:id/rotate
 * Rotate an existing API key.
 * The old key is revoked and a new raw key is returned.
 */
router.post(
  "/api-keys/:id/rotate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        req.body?.userId ||
        (req.headers["x-user-id"] as string | undefined);

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const { id } = req.params;

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_KEY_ID", "API key ID is required", 400);
        return;
      }

      const existing = apiKeys.get(id);

      if (!existing) {
        sendError(res, "API_KEY_NOT_FOUND", "API key not found", 404);
        return;
      }

      if (existing.userId !== userId) {
        sendError(
          res,
          "FORBIDDEN",
          "You do not have permission to rotate this key",
          403,
        );
        return;
      }

      if (isRevoked(existing)) {
        sendError(
          res,
          "KEY_ALREADY_REVOKED",
          "Cannot rotate a revoked key",
          409,
        );
        return;
      }

      const rawKey = generateRawKey();

      existing.hashedKey = hashKey(rawKey);
      existing.prefix = rawKey.slice(0, 7);
      existing.rotatedAt = new Date().toISOString();

      if (existing.expiresAt) {
        const ms = 30 * 24 * 60 * 60 * 1000;
        existing.expiresAt = new Date(Date.now() + ms).toISOString();
      }

      return res.status(200).json({
        success: true,
        data: {
          ...stripHash(existing),
          rawKey,
          rawKeyPreview: maskKey(rawKey),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * POST /api-keys/:id/revoke
 * Revoke an API key so it can no longer be used.
 */
router.post(
  "/api-keys/:id/revoke",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId =
        req.body?.userId ||
        (req.headers["x-user-id"] as string | undefined);

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const { id } = req.params;

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_KEY_ID", "API key ID is required", 400);
        return;
      }

      const existing = apiKeys.get(id);

      if (!existing) {
        sendError(res, "API_KEY_NOT_FOUND", "API key not found", 404);
        return;
      }

      if (existing.userId !== userId) {
        sendError(
          res,
          "FORBIDDEN",
          "You do not have permission to revoke this key",
          403,
        );
        return;
      }

      if (isRevoked(existing)) {
        sendError(
          res,
          "KEY_ALREADY_REVOKED",
          "API key is already revoked",
          409,
        );
        return;
      }

      existing.revokedAt = new Date().toISOString();

      return res.status(200).json({
        success: true,
        data: stripHash(existing),
      });
    } catch (err) {
      return next(err);
    }
  },
);

// --- Test helpers ---

export function __seedApiKey(key: ApiKey): void {
  apiKeys.set(key.id, key);
}

export function __resetApiKeys(): void {
  apiKeys.clear();
}

export function __getApiKeys(): Map<string, ApiKey> {
  return apiKeys;
}

export { generateRawKey as __generateRawKey, hashKey as __hashKey };

export default router;
