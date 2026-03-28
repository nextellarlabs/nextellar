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
