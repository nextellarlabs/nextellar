import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoiceListRouter, { invoices } from "../routes/invoices.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoiceListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function createMockToken(userId: string): string {
  const payload = JSON.stringify({ sub: userId, role: "user" });
  return Buffer.from(payload).toString("base64");
}

const ISSUER = "user-issuer";
const PAYER = "user-payer";
const OTHER = "user-other";

const BASE = {
  issuerId: ISSUER,
  payerId: PAYER,
  amount: 100,
  currency: "USD",
  lineItems: [],
  dueDate: new Date("2024-02-01"),
};

describe("GET /invoices", () => {
  const app = buildApp();

  beforeEach(() => {
    invoices.clear();
  });

  // --- empty list ---

  it("returns empty list when caller has no invoices", async () => {
    invoices.set("inv-other", {
      ...BASE,
      id: "inv-other",
      issuerId: "someone-else",
      payerId: "another-person",
      status: "pending",
      createdAt: new Date("2024-01-10"),
    });

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(OTHER)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  // --- visibility ---

  it("returns invoices where caller is the issuer", async () => {
    invoices.set("inv-1", {
      ...BASE,
      id: "inv-1",
      status: "pending",
      createdAt: new Date("2024-01-05"),
    });

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-1");
  });

  it("returns invoices where caller is the payer", async () => {
    invoices.set("inv-1", {
      ...BASE,
      id: "inv-1",
      status: "pending",
      createdAt: new Date("2024-01-05"),
    });

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(PAYER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-1");
  });

  it("does not return invoices where caller is neither issuer nor payer", async () => {
    invoices.set("inv-1", {
      ...BASE,
      id: "inv-1",
      status: "pending",
      createdAt: new Date("2024-01-05"),
    });

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(OTHER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  // --- status filter ---

  it("filters by status=paid", async () => {
    invoices.set("inv-paid", {
      ...BASE,
      id: "inv-paid",
      status: "paid",
      createdAt: new Date("2024-01-01"),
      paidAt: new Date("2024-01-10"),
      stellarTxHash: "tx-abc",
    });
    invoices.set("inv-pending", {
      ...BASE,
      id: "inv-pending",
      status: "pending",
      createdAt: new Date("2024-01-02"),
    });

    const res = await request(app)
      .get("/invoices?status=paid")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-paid");
  });

  it("returns all statuses when no status filter is given", async () => {
    for (const status of ["draft", "pending", "paid", "voided"] as const) {
      invoices.set(`inv-${status}`, {
        ...BASE,
        id: `inv-${status}`,
        status,
        createdAt: new Date("2024-01-01"),
      });
    }

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });

  // --- date range filter ---

  it("filters by from date", async () => {
    invoices.set("inv-old", {
      ...BASE,
      id: "inv-old",
      status: "pending",
      createdAt: new Date("2024-01-01"),
    });
    invoices.set("inv-new", {
      ...BASE,
      id: "inv-new",
      status: "pending",
      createdAt: new Date("2024-02-01"),
    });

    const res = await request(app)
      .get("/invoices?from=2024-01-15")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-new");
  });

  it("filters by to date", async () => {
    invoices.set("inv-old", {
      ...BASE,
      id: "inv-old",
      status: "pending",
      createdAt: new Date("2024-01-01"),
    });
    invoices.set("inv-new", {
      ...BASE,
      id: "inv-new",
      status: "pending",
      createdAt: new Date("2024-03-01"),
    });

    const res = await request(app)
      .get("/invoices?to=2024-02-01")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-old");
  });

  it("filters by combined status and date range", async () => {
    invoices.set("inv-a", {
      ...BASE,
      id: "inv-a",
      status: "pending",
      createdAt: new Date("2024-01-10"),
    });
    invoices.set("inv-b", {
      ...BASE,
      id: "inv-b",
      status: "paid",
      createdAt: new Date("2024-01-15"),
    });
    invoices.set("inv-c", {
      ...BASE,
      id: "inv-c",
      status: "pending",
      createdAt: new Date("2024-02-01"),
    });

    const res = await request(app)
      .get("/invoices?status=pending&from=2024-01-01&to=2024-01-31")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("inv-a");
  });

  // --- sort order ---

  it("returns results sorted by createdAt descending", async () => {
    invoices.set("inv-jan", {
      ...BASE,
      id: "inv-jan",
      status: "pending",
      createdAt: new Date("2024-01-01"),
    });
    invoices.set("inv-mar", {
      ...BASE,
      id: "inv-mar",
      status: "pending",
      createdAt: new Date("2024-03-01"),
    });
    invoices.set("inv-feb", {
      ...BASE,
      id: "inv-feb",
      status: "pending",
      createdAt: new Date("2024-02-01"),
    });

    const res = await request(app)
      .get("/invoices")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((i: { id: string }) => i.id);
    expect(ids).toEqual(["inv-mar", "inv-feb", "inv-jan"]);
  });

  // --- pagination ---

  it("paginates correctly with page and limit", async () => {
    for (let i = 1; i <= 5; i++) {
      invoices.set(`inv-${i}`, {
        ...BASE,
        id: `inv-${i}`,
        status: "pending",
        createdAt: new Date(`2024-01-0${i}`),
      });
    }

    const res = await request(app)
      .get("/invoices?page=2&limit=2")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.hasNext).toBe(true);
  });

  it("returns hasNext=false on the last page", async () => {
    for (let i = 1; i <= 3; i++) {
      invoices.set(`inv-${i}`, {
        ...BASE,
        id: `inv-${i}`,
        status: "pending",
        createdAt: new Date(`2024-01-0${i}`),
      });
    }

    const res = await request(app)
      .get("/invoices?page=2&limit=2")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.hasNext).toBe(false);
  });

  // --- validation ---

  it("rejects invalid page param", async () => {
    const res = await request(app)
      .get("/invoices?page=0")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("rejects invalid limit param", async () => {
    const res = await request(app)
      .get("/invoices?limit=200")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("rejects invalid from date", async () => {
    const res = await request(app)
      .get("/invoices?from=not-a-date")
      .set("Authorization", `Bearer ${createMockToken(ISSUER)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/invoices");

    expect(res.status).toBe(401);
  });
});
