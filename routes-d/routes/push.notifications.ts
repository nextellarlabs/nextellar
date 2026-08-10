/**
 * Push Notifications Route
 *
 * Provides HTTP endpoints to:
 *   POST /push/tokens/:userId        – register device tokens
 *   DELETE /push/tokens/:userId/:token – remove a specific token
 *   GET  /push/tokens/:userId        – list tokens for a user
 *   POST /push/send/:userId          – send a push notification to a user
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';
import {
  PushDispatcher,
  registerTokens,
  removeToken,
  getTokens,
  type PushPayload,
  type APNsProvider,
  type FCMProvider,
  type DeviceToken,
} from '../lib/pushDispatcher.js';

// ---------------------------------------------------------------------------
// Mock providers (in-memory stubs used by tests / dev)
// ---------------------------------------------------------------------------

/** Callable stub injected during tests. */
let mockApnsSend: ((token: string, payload: PushPayload) => Promise<{ success: boolean; reason?: string }>) | null = null;
let mockFcmSend: ((token: string, payload: PushPayload) => Promise<{ success: boolean; errorCode?: string; messageId?: string }>) | null = null;

export function __setMockApnsSend(fn: typeof mockApnsSend): void {
  mockApnsSend = fn;
}
export function __setMockFcmSend(fn: typeof mockFcmSend): void {
  mockFcmSend = fn;
}
export function __resetMocks(): void {
  mockApnsSend = null;
  mockFcmSend = null;
}

/** Default stub that always succeeds (used when no mock is set). */
const defaultApns: APNsProvider = {
  async send(token, payload) {
    if (mockApnsSend) return mockApnsSend(token, payload);
    return { success: true };
  },
};

const defaultFcm: FCMProvider = {
  async send(token, payload) {
    if (mockFcmSend) return mockFcmSend(token, payload);
    return { success: true, messageId: `mock-msg-${Date.now()}` };
  },
};

let dispatcherInstance = new PushDispatcher({ apns: defaultApns, fcm: defaultFcm });

/** Replace the dispatcher instance (test helper). */
export function __setDispatcher(d: PushDispatcher): void {
  dispatcherInstance = d;
}
export function __resetDispatcher(): void {
  dispatcherInstance = new PushDispatcher({ apns: defaultApns, fcm: defaultFcm });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * POST /push/tokens/:userId
 * Register one or more device tokens for a user.
 *
 * Body: { tokens: Array<{ token, platform, timezone?, quietHours?, lastUsedAt? }> }
 */
router.post(
  '/push/tokens/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const { tokens } = req.body as { tokens?: unknown };

      if (!Array.isArray(tokens) || tokens.length === 0) {
        sendError(res, 'VALIDATION_ERROR', '"tokens" must be a non-empty array', 400);
        return;
      }

      for (const t of tokens) {
        if (typeof (t as DeviceToken).token !== 'string' || !(t as DeviceToken).token) {
          sendError(res, 'VALIDATION_ERROR', 'Each token entry must have a string "token" field', 400);
          return;
        }
        const platform = (t as DeviceToken).platform;
        if (platform !== 'apns' && platform !== 'fcm') {
          sendError(res, 'VALIDATION_ERROR', '"platform" must be "apns" or "fcm"', 400);
          return;
        }
      }

      registerTokens(userId, tokens as Omit<DeviceToken, 'registeredAt'>[]);

      res.status(201).json({ success: true, userId, registered: tokens.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /push/tokens/:userId/:token
 * Remove a specific device token.
 */
router.delete(
  '/push/tokens/:userId/:token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, token } = req.params;
      removeToken(userId, decodeURIComponent(token));
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /push/tokens/:userId
 * List all registered tokens for a user (without exposing sensitive token strings in full).
 */
router.get(
  '/push/tokens/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const tokens = getTokens(userId);

      const safe = tokens.map((t) => ({
        tokenPrefix: t.token.slice(0, 8) + '…',
        platform: t.platform,
        timezone: t.timezone,
        quietHours: t.quietHours,
        registeredAt: t.registeredAt,
        lastUsedAt: t.lastUsedAt,
      }));

      res.status(200).json({ success: true, userId, tokens: safe, count: safe.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /push/send/:userId
 * Send a push notification to all registered devices for a user.
 *
 * Body: { title, body, data?, badge?, sound? }
 */
router.post(
  '/push/send/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const { title, body, data, badge, sound } = req.body as Partial<PushPayload>;

      if (!title || typeof title !== 'string') {
        sendError(res, 'VALIDATION_ERROR', '"title" is required', 400);
        return;
      }
      if (!body || typeof body !== 'string') {
        sendError(res, 'VALIDATION_ERROR', '"body" is required', 400);
        return;
      }

      const tokens = getTokens(userId);
      if (tokens.length === 0) {
        sendError(res, 'NO_TOKENS', 'No device tokens registered for this user', 404);
        return;
      }

      const payload: PushPayload = { title, body };
      if (data) payload.data = data;
      if (badge !== undefined) payload.badge = badge;
      if (sound) payload.sound = sound;

      const result = await dispatcherInstance.sendToUser(userId, payload);

      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
