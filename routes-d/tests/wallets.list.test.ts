import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import walletsListRouter, {
  __seedWallets,
  __resetWalletStore,
} from "../routes/wallets.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(walletsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-abc123";

const mockWallets = [
  {
    id: "w-1",
    address: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
    label: "Primary",
    isDefault: true,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "w-2",
    address: "GXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
    label: "Savings",
    isDefault: false,
    createdAt: "2024-01-02T00:00:00.000Z",
  },
  {
    id: "w-3",
    address: "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
    label: "Trading",
    isDefault: false,
    createdAt: "2024-01-03T00:00:00.000Z",
  },
];

describe("GET /wallets", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetWalletStore();
  });

  it("returns wallet list with isDefault marked for each wallet", async () => {
    __seedWallets(USER_ID, mockWallets);

    const res = await request(app)
      .get("/wallets")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
    res.body.data.forEach((w: { isDefault: unknown; label: unknown }) => {
      expect(typeof w.isDefault).toBe("boolean");
      expect(w.label).toBeDefined();
    });
  });

  it("returns empty array with pagination metadata when user has no wallets", async () => {
    const res = await request(app)
      .get("/wallets")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.page).toBe(1);
  });

  it("returns correct subset for given page and limit", async () => {
    __seedWallets(USER_ID, mockWallets);

    const res = await request(app)
      .get("/wallets?page=1&limit=2")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it("returns second page correctly", async () => {
    __seedWallets(USER_ID, mockWallets);

    const res = await request(app)
      .get("/wallets?page=2&limit=2")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("w-3");
  });

  it("marks exactly one wallet as default", async () => {
    __seedWallets(USER_ID, mockWallets);

    const res = await request(app)
      .get("/wallets")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    const defaultWallets = res.body.data.filter((w: { isDefault: boolean }) => w.isDefault === true);
    expect(defaultWallets.length).toBe(1);
    expect(defaultWallets[0].id).toBe("w-1");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).get("/wallets");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_PAGINATION for invalid page parameter", async () => {
    const res = await request(app)
      .get("/wallets?page=0")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });
});
