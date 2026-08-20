import { Router, Response } from "express";
import { sendError } from "../lib/response.js";
import {
  requireNotificationAuth,
  AuthenticatedRequest,
} from "../auth/notificationsAuth.js";
import {
  getNotificationFeed,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  createNotification,
  NotificationFeedOptions,
} from "../lib/notificationsStore.js";

const router = Router();

/**
 * GET /notifications/feed
 * Surface paginated unread and read notification views for the authenticated user.
 */
router.get(
  "/notifications/feed",
  requireNotificationAuth,
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { status, page, limit, retentionDays } = req.query;

      const options: NotificationFeedOptions = {};

      if (status === "unread" || status === "read" || status === "all") {
        options.status = status;
      }

      if (page) {
        const parsedPage = parseInt(page as string, 10);
        if (!isNaN(parsedPage)) options.page = parsedPage;
      }

      if (limit) {
        const parsedLimit = parseInt(limit as string, 10);
        if (!isNaN(parsedLimit)) options.limit = parsedLimit;
      }

      if (retentionDays) {
        const parsedDays = parseInt(retentionDays as string, 10);
        if (!isNaN(parsedDays) && parsedDays > 0) {
          options.retentionDays = parsedDays;
        }
      }

      const result = getNotificationFeed(userId, options);

      return res.status(200).json({
        success: true,
        data: result.items,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
          unreadCount: result.unreadCount,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      sendError(res, "SERVER_ERROR", message, 500);
    }
  }
);

/**
 * Alias GET /notifications
 */
router.get(
  "/notifications",
  requireNotificationAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId!;
    const { status, page, limit, retentionDays } = req.query;

    const options: NotificationFeedOptions = {};
    if (status === "unread" || status === "read" || status === "all") {
      options.status = status;
    }
    if (page) options.page = parseInt(page as string, 10);
    if (limit) options.limit = parseInt(limit as string, 10);
    if (retentionDays) options.retentionDays = parseInt(retentionDays as string, 10);

    const result = getNotificationFeed(userId, options);

    return res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        unreadCount: result.unreadCount,
      },
    });
  }
);

/**
 * PATCH /notifications/read-all
 * POST /notifications/read-all
 * Mark all unread notifications as read for the authenticated user.
 */
const markAllReadHandler = (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const result = markAllNotificationsAsRead(userId);

    return res.status(200).json({
      success: true,
      updatedCount: result.updatedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    sendError(res, "SERVER_ERROR", message, 500);
  }
};

router.patch("/notifications/read-all", requireNotificationAuth, markAllReadHandler);
router.post("/notifications/read-all", requireNotificationAuth, markAllReadHandler);
router.post("/notifications/mark-all-read", requireNotificationAuth, markAllReadHandler);

/**
 * PATCH /notifications/:id/read
 * POST /notifications/:id/read
 * Mark a single notification as read.
 */
const markSingleReadHandler = (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    if (!id) {
      sendError(res, "INVALID_REQUEST", "Notification ID is required", 400);
      return;
    }

    const updated = markNotificationAsRead(userId, id);

    if (!updated) {
      sendError(res, "NOTIFICATION_NOT_FOUND", "Notification not found", 404);
      return;
    }

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    sendError(res, "SERVER_ERROR", message, 500);
  }
};

router.patch("/notifications/:id/read", requireNotificationAuth, markSingleReadHandler);
router.post("/notifications/:id/read", requireNotificationAuth, markSingleReadHandler);

/**
 * POST /notifications
 * Create a notification for authenticated user or specified user in body (admin/testing).
 */
router.post(
  "/notifications",
  requireNotificationAuth,
  (req: AuthenticatedRequest, res: Response) => {
    try {
      const currentUserId = req.userId!;
      const { userId, title, message, type, metadata } = req.body || {};

      if (!title || !message) {
        sendError(res, "VALIDATION_ERROR", "Title and message are required", 400);
        return;
      }

      const targetUserId = userId || currentUserId;
      const created = createNotification({
        userId: targetUserId,
        title,
        message,
        type,
        metadata,
      });

      return res.status(201).json({
        success: true,
        data: created,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      sendError(res, "SERVER_ERROR", message, 500);
    }
  }
);

export default router;
