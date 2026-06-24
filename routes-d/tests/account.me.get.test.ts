import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountMeRouter, {
  __resetUsers,
  __seedUser,
} from "../routes/account.me.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountMeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /account/me", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetUsers();
  });

  it("returns the authenticated user profile", async () => {
    __seedUser({
      id: "user-1",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: "https://example.com/alice.png",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .get("/account/me")
      .set("x-user-id", "user-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("user-1");
    expect(res.body.data.email).toBe("alice@example.com");
    expect(res.body.data.displayName).toBe("Alice");
    expect(res.body.data.avatarUrl).toBe("https://example.com/alice.png");
    expect(res.body.data.createdAt).toBe("2024-01-01T00:00:00Z");
  });

  it("returns 401 when no authentication header is provided", async () => {
    const res = await request(app).get("/account/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when user profile does not exist", async () => {
    const res = await request(app)
      .get("/account/me")
      .set("x-user-id", "nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("omits optional fields when they are not set (partial profile)", async () => {
    __seedUser({
      id: "user-2",
      email: "bob@example.com",
      createdAt: "2024-06-01T00:00:00Z",
    });

    const res = await request(app)
      .get("/account/me")
      .set("x-user-id", "user-2");

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("user-2");
    expect(res.body.data.email).toBe("bob@example.com");
    expect(res.body.data).not.toHaveProperty("displayName");
    expect(res.body.data).not.toHaveProperty("avatarUrl");
  });

  it("does not expose internal fields beyond the safe set", async () => {
    __seedUser({
      id: "user-3",
      email: "charlie@example.com",
      displayName: "Charlie",
      createdAt: "2024-03-15T00:00:00Z",
    });

    const res = await request(app)
      .get("/account/me")
      .set("x-user-id", "user-3");

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.data);
    expect(keys).toEqual(
      expect.arrayContaining(["id", "email", "createdAt"]),
    );
    expect(keys.every((k) =>
      ["id", "email", "displayName", "avatarUrl", "createdAt"].includes(k),
    )).toBe(true);
  });
});
