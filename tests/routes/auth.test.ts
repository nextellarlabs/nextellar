import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import authRouter, {
  authDeps,
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
