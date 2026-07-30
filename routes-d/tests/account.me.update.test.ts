import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountMeUpdateRouter, {
  __resetUsers,
  __seedUser,
  __getUsers,
  __resetAudit,
  __getAudit,
} from "../routes/account.me.update.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountMeUpdateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("PATCH /account/me", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetUsers();
    __resetAudit();
  });

  it("returns 200 updated:true and reflects the new displayName", async () => {
    __seedUser({
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-1")
      .send({ displayName: "Alice Updated" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.profile.displayName).toBe("Alice Updated");
  });

  it("writes a single audit entry with before/after snapshots on change", async () => {
    __seedUser({
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      createdAt: "2024-01-01T00:00:00Z",
    });

    await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-1")
      .send({ displayName: "Alice Updated" });

    const entries = __getAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0].changedFields).toEqual(["displayName"]);
    expect(entries[0].before.displayName).toBe("Alice");
    expect(entries[0].after.displayName).toBe("Alice Updated");
    expect(entries[0].userId).toBe("user-1");
  });

  it("returns 200 updated:false when all sent values already match (no-op)", async () => {
    __seedUser({
      id: "user-2",
      email: "bob@example.com",
      displayName: "Bob",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-2")
      .send({ displayName: "Bob" });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);
    expect(__getAudit()).toHaveLength(0);
  });

  it("returns 200 updated:false and current profile when body is empty", async () => {
    __seedUser({
      id: "user-3",
      email: "charlie@example.com",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-3")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(false);
    expect(res.body.data.profile.id).toBe("user-3");
  });

  it("returns 400 INVALID_DISPLAY_NAME when displayName is an empty string", async () => {
    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-1")
      .send({ displayName: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DISPLAY_NAME");
  });

  it("returns 400 INVALID_DISPLAY_NAME when displayName is not a string", async () => {
    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-1")
      .send({ displayName: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DISPLAY_NAME");
  });

  it("returns 400 INVALID_AVATAR_URL when avatarUrl is an empty string", async () => {
    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-1")
      .send({ avatarUrl: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AVATAR_URL");
  });

  it("returns 401 UNAUTHORIZED when no x-user-id header is provided", async () => {
    const res = await request(app).patch("/account/me").send({ displayName: "Ghost" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 USER_NOT_FOUND when the user is not in the store", async () => {
    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "nonexistent")
      .send({ displayName: "Nobody" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("does not include undefined optional fields in the returned profile", async () => {
    __seedUser({
      id: "user-4",
      email: "dave@example.com",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/account/me")
      .set("x-user-id", "user-4")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.profile).not.toHaveProperty("displayName");
    expect(res.body.data.profile).not.toHaveProperty("avatarUrl");
  });
});
