import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import notificationFeedRouter from "../routes/notifications.feed.js";
import {
  __resetNotificationsStore,
  __seedNotifications,
} from "../lib/notificationsStore.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationFeedRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe("GET /notifications/feed & Route Handlers", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNotificationsStore();
  });

  describe("Authentication", () => {
    it("returns 401 Unauthorized when x-user-id header is missing", async () => {
      const res = await request(app).get("/notifications/feed");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("accepts Authorization Bearer header", async () => {
      const res = await request(app)
        .get("/notifications/feed")
        .set("Authorization", "Bearer user-bearer");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /notifications/feed Pagination & Views", () => {
    beforeEach(() => {
      __seedNotifications([
        {
          id: "notif-1",
          userId: "user-100",
          title: "First",
          message: "Message 1",
          read: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: "notif-2",
          userId: "user-100",
          title: "Second",
          message: "Message 2",
          read: true,
          readAt: new Date().toISOString(),
          createdAt: new Date(Date.now() - 1000).toISOString(),
        },
        {
          id: "notif-3",
          userId: "user-100",
          title: "Third",
          message: "Message 3",
          read: false,
          createdAt: new Date(Date.now() - 2000).toISOString(),
        },
      ]);
    });

    it("returns all notifications for user with default pagination", async () => {
      const res = await request(app)
        .get("/notifications/feed")
        .set("x-user-id", "user-100");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(3);
      expect(res.body.pagination.total).toBe(3);
      expect(res.body.pagination.unreadCount).toBe(2);
    });

    it("supports filtering by status=unread", async () => {
      const res = await request(app)
        .get("/notifications/feed?status=unread")
        .set("x-user-id", "user-100");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.every((n: { read: boolean }) => !n.read)).toBe(true);
    });

    it("supports filtering by status=read", async () => {
      const res = await request(app)
        .get("/notifications/feed?status=read")
        .set("x-user-id", "user-100");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe("notif-2");
    });

    it("supports limit and page parameters", async () => {
      const res = await request(app)
        .get("/notifications/feed?page=1&limit=2")
        .set("x-user-id", "user-100");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination.totalPages).toBe(2);
    });
  });

  describe("PATCH /notifications/:id/read & PATCH /notifications/read-all", () => {
    beforeEach(() => {
      __seedNotifications([
        {
          id: "read-target-1",
          userId: "user-mark",
          title: "Unread 1",
          message: "Unread message",
          read: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: "read-target-2",
          userId: "user-mark",
          title: "Unread 2",
          message: "Unread message 2",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ]);
    });

    it("marks single notification as read", async () => {
      const res = await request(app)
        .patch("/notifications/read-target-1/read")
        .set("x-user-id", "user-mark");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.read).toBe(true);
      expect(res.body.data.readAt).toBeDefined();
    });

    it("returns 404 if notification ID does not exist", async () => {
      const res = await request(app)
        .patch("/notifications/nonexistent-id/read")
        .set("x-user-id", "user-mark");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
    });

    it("marks all notifications as read", async () => {
      const res = await request(app)
        .patch("/notifications/read-all")
        .set("x-user-id", "user-mark");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updatedCount).toBe(2);

      const checkRes = await request(app)
        .get("/notifications/feed")
        .set("x-user-id", "user-mark");

      expect(checkRes.body.pagination.unreadCount).toBe(0);
    });
  });

  describe("POST /notifications (Creation)", () => {
    it("creates a new notification", async () => {
      const res = await request(app)
        .post("/notifications")
        .set("x-user-id", "user-create")
        .send({
          title: "New Alert",
          message: "Alert Body",
          type: "warning",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("New Alert");
      expect(res.body.data.userId).toBe("user-create");
    });

    it("returns 400 when missing required fields", async () => {
      const res = await request(app)
        .post("/notifications")
        .set("x-user-id", "user-create")
        .send({
          title: "Only Title",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Retention Window via Query Parameter", () => {
    it("prunes notifications older than retentionDays parameter during feed request", async () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      __seedNotifications([
        {
          id: "old-notif",
          userId: "user-retention",
          title: "Old",
          message: "Old",
          read: false,
          createdAt: fortyDaysAgo,
        },
        {
          id: "new-notif",
          userId: "user-retention",
          title: "New",
          message: "New",
          read: false,
          createdAt: fiveDaysAgo,
        },
      ]);

      const res = await request(app)
        .get("/notifications/feed?retentionDays=30")
        .set("x-user-id", "user-retention");

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe("new-notif");
    });
  });
});
