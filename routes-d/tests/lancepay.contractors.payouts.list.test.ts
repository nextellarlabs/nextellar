import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
} from "../routes/lancepay.contractors.payouts.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const now = new Date("2026-06-20T12:00:00Z").getTime();

function makePayout(
  id: string,
  contractorId: string,
  status: "pending" | "processing" | "completed" | "failed",
  offsetMs: number,
) {
  return {
    id,
    workspaceId: "ws-1",
    contractorId,
    amount: 100,
    currency: "USD",
    status,
    submittedAt: new Date(now - offsetMs).toISOString(),
  };
}

describe("GET /lancepay/contractors/:id/payouts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
  });

  it("returns empty list when contractor has no payouts", async () => {
    const res = await request(app).get("/lancepay/contractors/con-1/payouts");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns only payouts belonging to the specified contractor", async () => {
    __seedPayout(makePayout("pay-1", "con-1", "completed", 3000));
    __seedPayout(makePayout("pay-2", "con-1", "pending", 2000));
    __seedPayout(makePayout("pay-3", "con-2", "completed", 1000));

    const res = await request(app).get("/lancepay/contractors/con-1/payouts");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((p: { contractorId: string }) => p.contractorId === "con-1")).toBe(
      true,
    );
  });

  it("filters by status", async () => {
    __seedPayout(makePayout("pay-1", "con-1", "completed", 3000));
    __seedPayout(makePayout("pay-2", "con-1", "pending", 2000));
    __seedPayout(makePayout("pay-3", "con-1", "failed", 1000));

    const res = await request(app).get(
      "/lancepay/contractors/con-1/payouts?status=completed",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe("completed");
  });

  it("filters by date range (from)", async () => {
    __seedPayout(makePayout("pay-old", "con-1", "completed", 86400000)); // 1 day ago
    __seedPayout(makePayout("pay-new", "con-1", "completed", 1000));

    const from = new Date(now - 3600000).toISOString(); // 1 hour ago
    const res = await request(app).get(
      `/lancepay/contractors/con-1/payouts?from=${encodeURIComponent(from)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("pay-new");
  });

  it("filters by date range (to)", async () => {
    __seedPayout(makePayout("pay-old", "con-1", "completed", 86400000));
    __seedPayout(makePayout("pay-new", "con-1", "completed", 1000));

    const to = new Date(now - 3600000).toISOString(); // 1 hour ago
    const res = await request(app).get(
      `/lancepay/contractors/con-1/payouts?to=${encodeURIComponent(to)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("pay-old");
  });

  it("returns results sorted by submittedAt descending", async () => {
    __seedPayout(makePayout("pay-oldest", "con-1", "completed", 5000));
    __seedPayout(makePayout("pay-newest", "con-1", "completed", 1000));
    __seedPayout(makePayout("pay-middle", "con-1", "completed", 3000));

    const res = await request(app).get("/lancepay/contractors/con-1/payouts");
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toEqual(["pay-newest", "pay-middle", "pay-oldest"]);
  });

  it("paginates results", async () => {
    for (let i = 1; i <= 15; i++) {
      __seedPayout(makePayout(`pay-${i}`, "con-1", "completed", i * 1000));
    }

    const page1 = await request(app).get(
      "/lancepay/contractors/con-1/payouts?page=1&limit=5",
    );
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(5);
    expect(page1.body.pagination.total).toBe(15);
    expect(page1.body.pagination.hasNext).toBe(true);

    const page3 = await request(app).get(
      "/lancepay/contractors/con-1/payouts?page=3&limit=5",
    );
    expect(page3.status).toBe(200);
    expect(page3.body.data.length).toBe(5);
    expect(page3.body.pagination.hasNext).toBe(false);
  });

  it("returns 400 for invalid page", async () => {
    const res = await request(app).get("/lancepay/contractors/con-1/payouts?page=0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("returns 400 for invalid limit", async () => {
    const res = await request(app).get(
      "/lancepay/contractors/con-1/payouts?limit=200",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("returns 400 for invalid from date", async () => {
    const res = await request(app).get(
      "/lancepay/contractors/con-1/payouts?from=not-a-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FROM_DATE");
  });

  it("returns 400 for invalid to date", async () => {
    const res = await request(app).get(
      "/lancepay/contractors/con-1/payouts?to=bad-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TO_DATE");
  });
});
