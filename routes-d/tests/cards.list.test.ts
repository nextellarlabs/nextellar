import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cardsListRouter, {
  __seedCards,
  __resetCardStore,
} from "../routes/cards.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cardsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

beforeEach(() => {
  __resetCardStore();
});

describe("GET /cards – no cards", () => {
  it("returns empty array when user has no cards", async () => {
    const res = await request(app)
      .get("/cards")
      .set("x-user-id", "user-empty");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /cards – active cards only", () => {
  it("returns all active cards sorted first", async () => {
    __seedCards("user-1", [
      {
        id: "card-a",
        userId: "user-1",
        maskedNumber: "****1234",
        status: "active",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "card-b",
        userId: "user-1",
        maskedNumber: "****5678",
        status: "active",
        createdAt: "2024-02-01T00:00:00Z",
      },
    ]);

    const res = await request(app).get("/cards").set("x-user-id", "user-1");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].status).toBe("active");
    expect(res.body.data[1].status).toBe("active");
  });
});

describe("GET /cards – mixed status", () => {
  it("sorts active cards before closed ones", async () => {
    __seedCards("user-2", [
      {
        id: "card-closed",
        userId: "user-2",
        maskedNumber: "****0001",
        status: "closed",
        createdAt: "2023-01-01T00:00:00Z",
      },
      {
        id: "card-active",
        userId: "user-2",
        maskedNumber: "****0002",
        status: "active",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "card-suspended",
        userId: "user-2",
        maskedNumber: "****0003",
        status: "suspended",
        createdAt: "2024-03-01T00:00:00Z",
      },
    ]);

    const res = await request(app).get("/cards").set("x-user-id", "user-2");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].id).toBe("card-active");
    expect(["closed", "suspended"]).toContain(res.body.data[1].status);
    expect(["closed", "suspended"]).toContain(res.body.data[2].status);
  });

  it("masks card numbers in response", async () => {
    __seedCards("user-3", [
      {
        id: "card-x",
        userId: "user-3",
        maskedNumber: "****9999",
        status: "active",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]);

    const res = await request(app).get("/cards").set("x-user-id", "user-3");

    expect(res.status).toBe(200);
    expect(res.body.data[0].maskedNumber).toBe("****9999");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).get("/cards");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
