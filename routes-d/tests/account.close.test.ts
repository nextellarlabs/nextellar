import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountCloseRouter, {
  __getUsers,
  __seedUser,
  __getCloseRequests,
  __resetAccountClose,
} from "../routes/account.close.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountCloseRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /account/close", () => {
  const app = buildApp();

  const USER_ID = "user-abc123";
  const validRequest = {
    confirm: true,
  };

  beforeEach(() => {
    __resetAccountClose();
    __seedUser({
      id: USER_ID,
      email: "user@example.com",
      lastAuthenticatedAt: new Date().toISOString(),
    });
  });

  it("creates an account close request with valid data", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe("Account closure scheduled");
    expect(res.body.data.scheduledDeletionAt).toBeDefined();
    expect(res.body.data.cooldownDays).toBe(7);
    expect(res.body.data.canCancel).toBe(true);
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).post("/account/close").send(validRequest);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when confirm is missing", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONFIRMATION");
  });

  it("returns 400 when confirm is false", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send({ confirm: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("returns 403 when fresh authentication is required (no auth timestamp)", async () => {
    __resetAccountClose();
    __seedUser({
      id: USER_ID,
      email: "user@example.com",
    });

    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 403 when fresh authentication is required (auth too old)", async () => {
    __resetAccountClose();
    const oldAuth = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    __seedUser({
      id: USER_ID,
      email: "user@example.com",
      lastAuthenticatedAt: oldAuth,
    });

    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 404 when user is not found", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", "nonexistent-user")
      .send(validRequest);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("returns existing close request if already scheduled", async () => {
    const res1 = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res2.status).toBe(200);
    expect(res2.body.data.message).toBe("Account closure already scheduled");
    expect(res2.body.data.canCancel).toBe(true);
  });

  it("maintains close request correctly", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);

    const requests = __getCloseRequests();
    expect(requests.has(USER_ID)).toBe(true);

    const requestEntry = requests.get(USER_ID);
    expect(requestEntry!.userId).toBe(USER_ID);
    expect(requestEntry!.cancelled).toBe(false);
    expect(requestEntry!.scheduledDeletionAt).toBeDefined();
  });

  it("schedules deletion after 7 day cooldown", async () => {
    const res = await request(app)
      .post("/account/close")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);

    const requests = __getCloseRequests();
    const requestEntry = requests.get(USER_ID);
    
    const scheduledDate = new Date(requestEntry!.scheduledDeletionAt);
    const now = new Date();
    const diffDays = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    expect(diffDays).toBeCloseTo(7, 0);
  });
});
