import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import subListRouter, {
  __resetSubscriptions,
  __seedSubscription,
} from "../routes/subscriptions.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(subListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER = "user-abc";
const OTHER = "user-xyz";

const BASE = {
  billingInterval: "monthly" as const,
  status: "active" as const,
  createdAt: "2024-01-01T00:00:00Z",
};

describe("GET /subscriptions", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSubscriptions();
  });

  // --- empty ---

  it("returns empty list when user has no subscriptions", async () => {
    __seedSubscription({ id: "sub-other", userId: OTHER, planId: "pro", startDate: "2024-01-01", ...BASE });

    const res = await request(app)
      .get("/subscriptions")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  // --- visibility ---

  it("only returns subscriptions belonging to the caller", async () => {
    __seedSubscription({ id: "sub-1", userId: USER, planId: "pro", startDate: "2024-01-01", ...BASE });
    __seedSubscription({ id: "sub-2", userId: OTHER, planId: "pro", startDate: "2024-02-01", ...BASE });

    const res = await request(app)
      .get("/subscriptions")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("sub-1");
  });

  // --- status filter ---

  it("filters by status=paused", async () => {
    __seedSubscription({ id: "sub-active", userId: USER, planId: "pro", startDate: "2024-01-01", ...BASE, status: "active" });
    __seedSubscription({ id: "sub-paused", userId: USER, planId: "pro", startDate: "2024-02-01", ...BASE, status: "paused" });

    const res = await request(app)
      .get("/subscriptions?status=paused")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("sub-paused");
  });

  // --- plan filter ---

  it("filters by planId", async () => {
    __seedSubscription({ id: "sub-pro", userId: USER, planId: "pro", startDate: "2024-01-01", ...BASE });
    __seedSubscription({ id: "sub-basic", userId: USER, planId: "basic", startDate: "2024-02-01", ...BASE });

    const res = await request(app)
      .get("/subscriptions?planId=pro")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].planId).toBe("pro");
  });

  it("combines status and planId filters", async () => {
    __seedSubscription({ id: "sub-a", userId: USER, planId: "pro", startDate: "2024-01-01", ...BASE, status: "active" });
    __seedSubscription({ id: "sub-b", userId: USER, planId: "pro", startDate: "2024-02-01", ...BASE, status: "paused" });
    __seedSubscription({ id: "sub-c", userId: USER, planId: "basic", startDate: "2024-03-01", ...BASE, status: "active" });

    const res = await request(app)
      .get("/subscriptions?status=active&planId=pro")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("sub-a");
  });

  // --- sort order ---

  it("sorts by startDate ascending (oldest first)", async () => {
    __seedSubscription({ id: "sub-mar", userId: USER, planId: "pro", startDate: "2024-03-01", ...BASE });
    __seedSubscription({ id: "sub-jan", userId: USER, planId: "pro", startDate: "2024-01-01", ...BASE });
    __seedSubscription({ id: "sub-feb", userId: USER, planId: "pro", startDate: "2024-02-01", ...BASE });

    const res = await request(app)
      .get("/subscriptions")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual(["sub-jan", "sub-feb", "sub-mar"]);
  });

  // --- pagination ---

  it("paginates correctly", async () => {
    for (let i = 1; i <= 5; i++) {
      __seedSubscription({ id: `sub-${i}`, userId: USER, planId: "pro", startDate: `2024-01-0${i}`, ...BASE });
    }

    const res = await request(app)
      .get("/subscriptions?page=2&limit=2")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.hasNext).toBe(true);
  });

  it("returns hasNext=false on the last page", async () => {
    for (let i = 1; i <= 3; i++) {
      __seedSubscription({ id: `sub-${i}`, userId: USER, planId: "pro", startDate: `2024-01-0${i}`, ...BASE });
    }

    const res = await request(app)
      .get("/subscriptions?page=2&limit=2")
      .set("x-user-id", USER);

    expect(res.status).toBe(200);
    expect(res.body.pagination.hasNext).toBe(false);
  });

  // --- validation ---

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/subscriptions");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects invalid page", async () => {
    const res = await request(app)
      .get("/subscriptions?page=0")
      .set("x-user-id", USER);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("rejects invalid limit", async () => {
    const res = await request(app)
      .get("/subscriptions?limit=500")
      .set("x-user-id", USER);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });
});
