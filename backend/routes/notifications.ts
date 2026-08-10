import { Router, Request, Response, NextFunction } from 'express';

const router = Router();

export type NotificationDependencies = {
  sendPushNotification: (payload: unknown) => Promise<void>;
};

// Swappable dependency — replace in production with your push provider (FCM, APNS, etc.)
export const notificationDeps: NotificationDependencies = {
  sendPushNotification: async (_payload: unknown) => {
    // no-op stub
  },
};

/**
 * POST /notifications
 * Queues a push notification. Push delivery is fire-and-forget:
 * failures are logged server-side but do not fail the HTTP response,
 * because push delivery is non-critical and callers should not block
 * on it. The route always returns 200 immediately after enqueuing.
 */
router.post(
  '/notifications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload: unknown = req.body;

      if (payload === null || typeof payload !== 'object') {
        res.status(400).json({ success: false, message: 'Invalid notification payload' });
        return;
      }

      // Fire-and-forget: attach a .catch so the rejection is never unhandled.
      notificationDeps.sendPushNotification(payload).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[notifications] push delivery failed:', message);
      });

      res.status(200).json({ success: true, message: 'Notification queued' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
