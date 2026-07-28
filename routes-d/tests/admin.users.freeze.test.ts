import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedUser,
  __getUser,
  __getAuditLog,
  __resetUsers,
} from "../routes/admin.users.freeze.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const ACTIVE_USER = {
  id: "user-1",
  status: "active" as const,
  updatedAt: "2024-01-01T00:00:00Z",
};

const FROZEN_USER = {
  id: "user-2",
  status: "frozen" as const,
  frozenAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("POST /admin/users/:id/freeze", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetUsers();
    __seedUser(ACTIVE_USER);
    __seedUser(FROZEN_USER);
  });

  it("freezes an active account and returns 200", async () => {
    const res = await request(app)
      .post("/admin/users/user-1/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "freeze,read");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("frozen");
    expect(res.body.data.frozenBy).toBe("op-1");
    expect(res.body.data.frozenAt).toBeDefined();
  });

  it("persists the status change in storage", async () => {
    await request(app)
      .post("/admin/users/user-1/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "freeze");

    const stored = __getUser("user-1")!;
    expect(stored.status).toBe("frozen");
    expect(stored.frozenAt).toBeDefined();
  });

  it("emits an audit event on successful freeze", async () => {
    await request(app)
      .post("/admin/users/user-1/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "freeze");

    const log = __getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("user.freeze");
    expect(log[0].performedBy).toBe("op-1");
    expect(log[0].userId).toBe("user-1");
    expect(log[0].scope).toBe("freeze");
  });

  it("returns 409 when account is already frozen", async () => {
    const res = await request(app)
      .post("/admin/users/user-2/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "freeze");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_FROZEN");
  });

  it("returns 403 when operator does not have the freeze scope", async () => {
    const res = await request(app)
      .post("/admin/users/user-1/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "read,write");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when operator identity is missing", async () => {
    const res = await request(app)
      .post("/admin/users/user-1/freeze");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when user does not exist", async () => {
    const res = await request(app)
      .post("/admin/users/nonexistent/freeze")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "freeze");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("accepts operatorId from the request body", async () => {
    const res = await request(app)
      .post("/admin/users/user-1/freeze")
      .set("x-operator-scopes", "freeze")
      .send({ operatorId: "op-body" });

    expect(res.status).toBe(200);
    expect(res.body.data.frozenBy).toBe("op-body");
  });
});
