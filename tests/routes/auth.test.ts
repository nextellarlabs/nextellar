import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import authRouter, {
  authDeps,
  sanitizeRedirect,
  __resetLoginRateLimitState,
} from "../../backend/routes/auth";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /auth/login", () => {
  const app = buildApp();
  const ip = "203.0.113.10";
  let authenticateUserMock: jest.MockedFunction<typeof authDeps.authenticateUser>;

  beforeEach(() => {
    __resetLoginRateLimitState();
    authenticateUserMock = jest.fn();
    authDeps.authenticateUser = authenticateUserMock;
    jest.clearAllMocks();
  });

  it("allows 10 failed attempts and returns 429 on the 11th", async () => {
    authenticateUserMock.mockResolvedValue(null);

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post("/auth/login")
        .set("x-forwarded-for", ip)
        .send({ username: "alice", password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/auth/login")
      .set("x-forwarded-for", ip)
      .send({ username: "alice", password: "wrong-password" });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(authenticateUserMock).toHaveBeenCalledTimes(10);
  });

  it("resets rate-limit counters after successful login", async () => {
    authenticateUserMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: "user-1", token: "token-1" })
      .mockResolvedValueOnce(null);

    const firstAttempt = await request(app)
      .post("/auth/login")
      .set("x-forwarded-for", ip)
      .send({ username: "alice", password: "wrong-password" });
    expect(firstAttempt.status).toBe(401);

    const secondAttempt = await request(app)
      .post("/auth/login")
      .set("x-forwarded-for", ip)
      .send({ username: "alice", password: "wrong-password" });
    expect(secondAttempt.status).toBe(401);

    const successfulAttempt = await request(app)
      .post("/auth/login")
      .set("x-forwarded-for", ip)
      .send({ username: "alice", password: "correct-password" });
    expect(successfulAttempt.status).toBe(200);

    const postResetAttempt = await request(app)
      .post("/auth/login")
      .set("x-forwarded-for", ip)
      .send({ username: "alice", password: "wrong-password" });
    expect(postResetAttempt.status).toBe(401);
  });

  it("sets Set-Cookie with HttpOnly, Secure, SameSite=Strict, Path=/, and Max-Age=3600 in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      authenticateUserMock.mockResolvedValue({
        userId: "user-1",
        token: "session-token-value",
      });

      const res = await request(app)
        .post("/auth/login")
        .send({ username: "alice", password: "correct-password" });

      expect(res.status).toBe(200);
      const raw = res.headers["set-cookie"];
      expect(raw).toBeDefined();
      const header = Array.isArray(raw) ? raw.join(";") : String(raw);
      expect(header).toMatch(/session=/);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/;\s*Secure(?:;|$)/i);
      expect(header).toMatch(/SameSite=Strict/i);
      expect(header).toMatch(/Path=\//i);
      expect(header).toMatch(/Max-Age=3600/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("sets HttpOnly and SameSite=Strict but omits Secure when NODE_ENV is not production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      authenticateUserMock.mockResolvedValue({
        userId: "user-1",
        token: "session-token-value",
      });

      const res = await request(app)
        .post("/auth/login")
        .send({ username: "alice", password: "correct-password" });

      expect(res.status).toBe(200);
      const raw = res.headers["set-cookie"];
      const header = Array.isArray(raw) ? raw.join(";") : String(raw);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Strict/i);
      expect(header).not.toMatch(/;\s*Secure(?:;|$)/i);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe("sanitizeRedirect", () => {
  it("returns the path when it is on the allowlist", () => {
    expect(sanitizeRedirect("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirect("/settings")).toBe("/settings");
    expect(sanitizeRedirect("/")).toBe("/");
  });

  it("returns '/' for an absolute URL pointing to an external host", () => {
    expect(sanitizeRedirect("https://evil.com/steal")).toBe("/");
  });

  it("returns '/' for a protocol-relative URL", () => {
    expect(sanitizeRedirect("//evil.com/steal")).toBe("/");
  });

  it("returns '/' for a different-scheme URL", () => {
    expect(sanitizeRedirect("javascript:alert(1)")).toBe("/");
  });

  it("returns '/' for a path not on the allowlist", () => {
    expect(sanitizeRedirect("/admin/secret")).toBe("/");
    expect(sanitizeRedirect("/not-allowed")).toBe("/");
  });

  it("returns '/' for empty or missing values", () => {
    expect(sanitizeRedirect("")).toBe("/");
    expect(sanitizeRedirect(null)).toBe("/");
    expect(sanitizeRedirect(undefined)).toBe("/");
  });
});

describe("GET /auth/callback", () => {
  const app = buildApp();

  it("redirects to a valid allowlisted path", async () => {
    const res = await request(app).get("/auth/callback?redirect=/dashboard");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/dashboard");
  });

  it("redirects to '/' for an absolute external URL", async () => {
    const res = await request(app).get(
      "/auth/callback?redirect=https://evil.com/phish",
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("redirects to '/' for a different-host URL", async () => {
    const res = await request(app).get(
      "/auth/callback?redirect=//evil.com/steal",
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("redirects to '/' when no redirect param is provided", async () => {
    const res = await request(app).get("/auth/callback");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });
});

describe("POST /forgot-password", () => {
  const app = buildApp();
  let generateResetTokenMock: jest.MockedFunction<typeof authDeps.generateResetToken>;
  let sendResetEmailMock: jest.MockedFunction<typeof authDeps.sendResetEmail>;
  let sendAdminAlertMock: jest.MockedFunction<typeof authDeps.sendAdminAlert>;

  beforeEach(() => {
    generateResetTokenMock = jest.fn().mockResolvedValue("test-token-abc");
    sendResetEmailMock = jest.fn().mockResolvedValue(undefined);
    sendAdminAlertMock = jest.fn().mockResolvedValue(undefined);
    authDeps.generateResetToken = generateResetTokenMock;
    authDeps.sendResetEmail = sendResetEmailMock;
    authDeps.sendAdminAlert = sendAdminAlertMock;
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  it("returns 400 when email is missing", async () => {
    const res = await request(app).post("/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 and sends reset email", async () => {
    const res = await request(app)
      .post("/forgot-password")
      .send({ email: "user@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendResetEmailMock).toHaveBeenCalledWith("user@example.com", "test-token-abc");
  });

  it("does not call sendAdminAlert when ADMIN_ALERT_EMAIL is not set", async () => {
    await request(app)
      .post("/forgot-password")
      .send({ email: "user@example.com" });

    expect(sendAdminAlertMock).not.toHaveBeenCalled();
  });

  it("calls sendAdminAlert with admin email when ADMIN_ALERT_EMAIL is set", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@company.com";

    await request(app)
      .post("/forgot-password")
      .send({ email: "user@example.com" });

    expect(sendAdminAlertMock).toHaveBeenCalledWith("ops@company.com", "user@example.com");
  });

  it("does not include the reset token in the admin alert", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@company.com";

    await request(app)
      .post("/forgot-password")
      .send({ email: "user@example.com" });

    const [, alertArg2] = sendAdminAlertMock.mock.calls[0];
    // second arg is the requesting email, not the token
    expect(alertArg2).toBe("user@example.com");
    expect(alertArg2).not.toBe("test-token-abc");
    // ensure token was never passed to sendAdminAlert at all
    const allArgs = sendAdminAlertMock.mock.calls[0];
    expect(allArgs).not.toContain("test-token-abc");
  });
});
