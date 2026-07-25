import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import notificationFeedRouter from "../../routes/notifications.feed.js";
import { __resetNotificationsStore } from "../../lib/notificationsStore.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationFeedRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe("In-App Notification Feed Integration Lifecycle", () => {
  const app = buildApp();
  const userId = "user-integration-test";

  beforeEach(() => {
    __resetNotificationsStore();
  });

  it("handles full notification creation, pagination, read filtering, mark-read, and retention flow", async () => {
    // 1. Create 5 notifications for the user
    for (let i = 1; i <= 5; i++) {
      const createRes = await request(app)
        .post("/notifications")
        .set("x-user-id", userId)
        .send({
          title: `Notification ${i}`,
          message: `Body text for notification ${i}`,
          type: i % 2 === 0 ? "system" : "transaction",
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.id).toBeDefined();
    }

    // 2. Fetch paginated feed (limit = 3, page = 1)
    const feedPage1 = await request(app)
      .get("/notifications/feed?page=1&limit=3")
      .set("x-user-id", userId);

    expect(feedPage1.status).toBe(200);
    expect(feedPage1.body.data.length).toBe(3);
    expect(feedPage1.body.pagination.total).toBe(5);
    expect(feedPage1.body.pagination.unreadCount).toBe(5);

    const firstNotifId = feedPage1.body.data[0].id;

    // 3. Mark single notification as read
    const markSingleRes = await request(app)
      .patch(`/notifications/${firstNotifId}/read`)
      .set("x-user-id", userId);

    expect(markSingleRes.status).toBe(200);
    expect(markSingleRes.body.data.read).toBe(true);

    // 4. Verify unread feed has 4 items
    const unreadFeed = await request(app)
      .get("/notifications/feed?status=unread")
      .set("x-user-id", userId);

    expect(unreadFeed.status).toBe(200);
    expect(unreadFeed.body.data.length).toBe(4);
    expect(unreadFeed.body.pagination.unreadCount).toBe(4);

    // 5. Mark all as read
    const markAllRes = await request(app)
      .post("/notifications/read-all")
      .set("x-user-id", userId);

    expect(markAllRes.status).toBe(200);
    expect(markAllRes.body.updatedCount).toBe(4);

    // 6. Verify read feed has 5 items and unread count is 0
    const readFeed = await request(app)
      .get("/notifications/feed?status=read")
      .set("x-user-id", userId);

    expect(readFeed.status).toBe(200);
    expect(readFeed.body.data.length).toBe(5);
    expect(readFeed.body.pagination.unreadCount).toBe(0);
  });
});
