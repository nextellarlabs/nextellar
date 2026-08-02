import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import notificationsLongpollRouter, {
  __seedNotification,
  __publishNotification,
  __resetNotifications,
} from "../routes/notifications.longpoll.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(notificationsLongpollRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-longpoll-1";
const OTHER_USER = "user-longpoll-2";

describe("GET /notifications/poll (Long-polling)", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetNotifications();
  });

  it("returns immediate response when events exist after cursor", async () => {
    const e1 = __seedNotification({
      userId: USER_ID,
      type: "payment",
      title: "Payment Received",
      message: "Received 100 USDC",
      createdAt: "2024-06-01T10:00:00Z",
    });

    const res = await request(app)
      .get("/notifications/poll?cursor=0")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timeout).toBe(false);
    expect(res.body.data.events.length).toBe(1);
    expect(res.body.data.events[0].id).toBe(e1.id);
    expect(res.body.data.cursor).toBe(e1.id);
  });

  it("returns empty wait response on timeout when no new events occur", async () => {
    const res = await request(app)
      .get("/notifications/poll?cursor=0&timeoutMs=200")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timeout).toBe(true);
    expect(res.body.data.events).toEqual([]);
    expect(res.body.data.cursor).toBe(0);
  });

  it("resolves active long-poll request immediately when new notification is published", async () => {
    // Start long poll request with 1000ms timeout
    const pollPromise = request(app)
      .get("/notifications/poll?cursor=0&timeoutMs=1000")
      .set("x-user-id", USER_ID);

    // Publish notification mid-request after 50ms delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    __publishNotification(USER_ID, {
      type: "alert",
      title: "Security Alert",
      message: "New login detected",
    });

    const res = await pollPromise;

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timeout).toBe(false);
    expect(res.body.data.events.length).toBe(1);
    expect(res.body.data.events[0].title).toBe("Security Alert");
  });

  it("advances cursor properly on subsequent requests", async () => {
    const e1 = __seedNotification({
      userId: USER_ID,
      type: "info",
      title: "Event 1",
      message: "Msg 1",
      createdAt: "2024-06-01T10:00:00Z",
    });

    const e2 = __seedNotification({
      userId: USER_ID,
      type: "info",
      title: "Event 2",
      message: "Msg 2",
      createdAt: "2024-06-01T10:01:00Z",
    });

    // Poll with cursor = e1.id -> should only return e2
    const res = await request(app)
      .get(`/notifications/poll?cursor=${e1.id}`)
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBe(1);
    expect(res.body.data.events[0].id).toBe(e2.id);
    expect(res.body.data.cursor).toBe(e2.id);
  });

  it("coalesces multiple events between polls", async () => {
    __seedNotification({
      userId: USER_ID,
      type: "info",
      title: "Event 1",
      message: "Msg 1",
      createdAt: "2024-06-01T10:00:00Z",
    });
    __seedNotification({
      userId: USER_ID,
      type: "info",
      title: "Event 2",
      message: "Msg 2",
      createdAt: "2024-06-01T10:01:00Z",
    });

    const res = await request(app)
      .get("/notifications/poll?cursor=0")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBe(2);
    expect(res.body.data.count).toBe(2);
  });

  it("rejects request missing x-user-id header with 401 UNAUTHORIZED", async () => {
    const res = await request(app).get("/notifications/poll");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
