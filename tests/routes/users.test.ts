import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

// Mock the auth middleware before importing the router so the module
// loader never reaches backend/auth/token.ts (which requires jsonwebtoken).
jest.mock("../../backend/middleware/auth.js", () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import usersRouter, { deps } from "../../backend/routes/users.js";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

const FULL_DB_USER = {
  id: VALID_UUID,
  username: "alice",
  email: "alice@example.com",
  createdAt: "2024-01-01T00:00:00.000Z",
  role: "user",
  passwordHash: "$2b$10$supersecrethashedvalue",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(usersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /users/:id", () => {
  const app = buildApp();

  afterEach(() => jest.restoreAllMocks());

  it("returns 200 with only safe public fields", async () => {
    jest.spyOn(deps, "getUserById").mockResolvedValue(FULL_DB_USER);

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: VALID_UUID,
      username: "alice",
      email: "alice@example.com",
      createdAt: "2024-01-01T00:00:00.000Z",
      role: "user",
    });
  });

  it("never includes passwordHash in the response", async () => {
    jest.spyOn(deps, "getUserById").mockResolvedValue(FULL_DB_USER);

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("supersecrethashedvalue");
  });

  it("returns 404 with standard error shape when user does not exist", async () => {
    jest.spyOn(deps, "getUserById").mockResolvedValue(null);

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("User not found");
  });

  it("returns 400 with standard error shape for a non-UUID id", async () => {
    const spy = jest.spyOn(deps, "getUserById");

    const res = await request(app).get("/users/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("INVALID_ID");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 500 without crashing on unexpected DB error", async () => {
    jest
      .spyOn(deps, "getUserById")
      .mockRejectedValue(new Error("DB timeout"));

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("DB timeout");
  });
});
