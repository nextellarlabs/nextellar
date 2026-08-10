/**
 * routes-d/routes/notifications.prefs.ts
 *
 * Notification preference management endpoints.
 *
 *   GET   /notifications/preferences     – return current prefs for the user
 *   PATCH /notifications/preferences     – update one or more event-class channels
 *
 * Supported event classes and channels
 * -------------------------------------
 *
 *   Event classes: payment | transfer | security | marketing | system
 *   Channels per class: email | sms | push | in_app
 *
 * Default baseline (all users start here unless they have saved prefs):
 *
 *   payment:   email, in_app
 *   transfer:  email, in_app
 *   security:  email, sms, push, in_app  (all channels – security is critical)
 *   marketing: email
 *   system:    email, in_app
 *
 * Validation rules
 * ----------------
 * - Unknown event classes are rejected (400 UNKNOWN_EVENT_CLASS).
 * - Unknown channels within a known class are rejected (400 UNSUPPORTED_CHANNEL).
 * - The value must be an array; non-array values are rejected (400 INVALID_CHANNEL_LIST).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Channel = 'email' | 'sms' | 'push' | 'in_app';
export type EventClass =
  | 'payment'
  | 'transfer'
  | 'security'
  | 'marketing'
  | 'system';

export type NotificationPreferences = Record<EventClass, Channel[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPORTED_CHANNELS: ReadonlySet<Channel> = new Set([
  'email',
  'sms',
  'push',
  'in_app',
]);

export const SUPPORTED_EVENT_CLASSES: ReadonlySet<EventClass> = new Set([
  'payment',
  'transfer',
  'security',
  'marketing',
  'system',
]);

/**
 * Documented default baseline: new users start with these preferences.
 */
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPreferences> = {
  payment: ['email', 'in_app'],
  transfer: ['email', 'in_app'],
  security: ['email', 'sms', 'push', 'in_app'],
  marketing: ['email'],
  system: ['email', 'in_app'],
};

// ---------------------------------------------------------------------------
// In-memory store (per-user, keyed by userId)
// ---------------------------------------------------------------------------

const prefsStore = new Map<string, NotificationPreferences>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPrefsForUser(userId: string): NotificationPreferences {
  const stored = prefsStore.get(userId);
  if (stored) return stored;

  // Return a deep copy of defaults so mutations don't affect the constant.
  return {
    payment: [...DEFAULT_NOTIFICATION_PREFS.payment],
    transfer: [...DEFAULT_NOTIFICATION_PREFS.transfer],
    security: [...DEFAULT_NOTIFICATION_PREFS.security],
    marketing: [...DEFAULT_NOTIFICATION_PREFS.marketing],
    system: [...DEFAULT_NOTIFICATION_PREFS.system],
  };
}

function deduplicateChannels(channels: Channel[]): Channel[] {
  return [...new Set(channels)];
}

type UpdatePayload = Partial<Record<EventClass, unknown>>;

interface ValidationError {
  field: string;
  code: string;
  message: string;
}

function validateUpdate(body: UpdatePayload): ValidationError | null {
  for (const [key, value] of Object.entries(body)) {
    // Reject unknown event classes.
    if (!SUPPORTED_EVENT_CLASSES.has(key as EventClass)) {
      return {
        field: key,
        code: 'UNKNOWN_EVENT_CLASS',
        message: `Unknown event class: "${key}". Supported classes: ${[...SUPPORTED_EVENT_CLASSES].join(', ')}`,
      };
    }

    // Value must be an array.
    if (!Array.isArray(value)) {
      return {
        field: key,
        code: 'INVALID_CHANNEL_LIST',
        message: `Channels for "${key}" must be an array`,
      };
    }

    // Each item must be a known channel.
    for (const ch of value) {
      if (!SUPPORTED_CHANNELS.has(ch as Channel)) {
        return {
          field: key,
          code: 'UNSUPPORTED_CHANNEL',
          message: `Unsupported channel "${ch}" for event class "${key}". Supported channels: ${[...SUPPORTED_CHANNELS].join(', ')}`,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /notifications/preferences
// ---------------------------------------------------------------------------
router.get(
  '/notifications/preferences',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers['x-user-id'] as string | undefined;

      if (!userId || userId.trim() === '') {
        sendError(res, 'UNAUTHORIZED', 'x-user-id header is required', 401);
        return;
      }

      const prefs = getPrefsForUser(userId.trim());

      return res.status(200).json({
        success: true,
        data: {
          userId: userId.trim(),
          preferences: prefs,
          isDefault: !prefsStore.has(userId.trim()),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /notifications/preferences
// ---------------------------------------------------------------------------
router.patch(
  '/notifications/preferences',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers['x-user-id'] as string | undefined;

      if (!userId || userId.trim() === '') {
        sendError(res, 'UNAUTHORIZED', 'x-user-id header is required', 401);
        return;
      }

      const uid = userId.trim();
      const body = req.body as UpdatePayload;

      if (
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body)
      ) {
        sendError(res, 'INVALID_BODY', 'Request body must be a JSON object', 400);
        return;
      }

      const keys = Object.keys(body);

      if (keys.length === 0) {
        // No-op: return current prefs unchanged.
        const prefs = getPrefsForUser(uid);
        return res.status(200).json({
          success: true,
          data: {
            userId: uid,
            preferences: prefs,
            updated: false,
          },
        });
      }

      const validationError = validateUpdate(body);
      if (validationError) {
        sendError(res, validationError.code, validationError.message, 400);
        return;
      }

      // Apply the update.
      const current = getPrefsForUser(uid);
      const updated: NotificationPreferences = { ...current };

      for (const [key, value] of Object.entries(body)) {
        updated[key as EventClass] = deduplicateChannels(value as Channel[]);
      }

      prefsStore.set(uid, updated);

      return res.status(200).json({
        success: true,
        data: {
          userId: uid,
          preferences: updated,
          updated: true,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __resetNotificationPrefs(): void {
  prefsStore.clear();
}

export function __seedNotificationPrefs(
  userId: string,
  prefs: NotificationPreferences,
): void {
  prefsStore.set(userId, { ...prefs });
}

export function __getNotificationPrefs(
  userId: string,
): NotificationPreferences | undefined {
  return prefsStore.get(userId);
}
