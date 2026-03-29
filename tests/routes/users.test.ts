import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

const FULL_DB_USER = {
  id: VALID_UUID,
  username: "alice",
  email: "alice@example.com",
  createdAt: "2024-01-01T00:00:00.000Z",
  role: "user",
  passwordHash: "$2b$10$supersecrethashedvalue",
};

jest.mock("../../backend/routes/users", () => {
  const actual = jest.requireActual("../../backend/routes/users");
  return { ...actual, getUserById: jest.fn() };
});

import usersRouter, { getUserById } from "../../backend/routes/users";

const mockGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;

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

  afterEach(() => jest.clearAllMocks());

  it("returns 200 with only safe public fields", async () => {
    mockGetUserById.mockResolvedValue(FULL_DB_USER);

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
    mockGetUserById.mockResolvedValue(FULL_DB_USER);

    const res = await request(app).get(`/users/${VALID_UUID}`);

    // Check both the parsed body and the raw JSON string
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain("supersecrethashedvalue");
  });

  it("returns 404 when user does not exist", async () => {
    mockGetUserById.mockResolvedValue(null);

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("User not found");
  });

  it("returns 400 for a non-UUID id", async () => {
    const res = await request(app).get("/users/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  it("returns 500 without crashing on unexpected DB error", async () => {
    mockGetUserById.mockRejectedValue(new Error("DB timeout"));

    const res = await request(app).get(`/users/${VALID_UUID}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("DB timeout");
  });
});
