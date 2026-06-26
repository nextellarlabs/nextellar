import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContract,
  __resetContracts,
  __getContracts,
} from "../routes/lancepay.contracts.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function seedContract(overrides: Partial<Parameters<typeof __seedContract>[0]> = {}) {
  __seedContract({
    id: overrides.id ?? "contract-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    contractorId: overrides.contractorId ?? "con-1",
    status: overrides.status ?? "active",
    currency: overrides.currency ?? "USD",
    rate: overrides.rate ?? 100,
    scope: overrides.scope ?? "Frontend work",
    startDate: overrides.startDate ?? "2026-01-01T00:00:00Z",
    endDate: overrides.endDate,
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
  });
}

describe("GET /lancepay/contracts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContracts();
  });

  it("returns an empty list when no contracts exist", async () => {
    const res = await request(app).get("/lancepay/contracts");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("filters contracts by workspace, contractor, status, and currency", async () => {
    seedContract({ id: "contract-1", workspaceId: "ws-1", contractorId: "con-1", status: "active", currency: "USD" });
    seedContract({ id: "contract-2", workspaceId: "ws-1", contractorId: "con-2", status: "active", currency: "USD" });
    seedContract({ id: "contract-3", workspaceId: "ws-1", contractorId: "con-1", status: "draft", currency: "USD" });
    seedContract({ id: "contract-4", workspaceId: "ws-2", contractorId: "con-1", status: "active", currency: "USD" });
    seedContract({ id: "contract-5", workspaceId: "ws-1", contractorId: "con-1", status: "active", currency: "EUR" });

    const res = await request(app)
      .get("/lancepay/contracts?contractor=con-1&status=active&currency=usd")
      .set("x-lancepay-workspace-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("contract-1");
  });

  it("paginates contracts sorted by start date descending", async () => {
    seedContract({ id: "old", startDate: "2026-01-01T00:00:00Z" });
    seedContract({ id: "middle", startDate: "2026-02-01T00:00:00Z" });
    seedContract({ id: "new", startDate: "2026-03-01T00:00:00Z" });

    const page1 = await request(app).get("/lancepay/contracts?page=1&limit=2");
    expect(page1.status).toBe(200);
    expect(page1.body.data.map((contract: { id: string }) => contract.id)).toEqual(["new", "middle"]);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, hasNext: true });

    const page2 = await request(app).get("/lancepay/contracts?page=2&limit=2");
    expect(page2.status).toBe(200);
    expect(page2.body.data.map((contract: { id: string }) => contract.id)).toEqual(["old"]);
    expect(page2.body.pagination.hasNext).toBe(false);
  });

  it("returns validation errors for invalid pagination", async () => {
    const invalidPage = await request(app).get("/lancepay/contracts?page=0");
    expect(invalidPage.status).toBe(400);
    expect(invalidPage.body.error.code).toBe("INVALID_PAGE");

    const invalidLimit = await request(app).get("/lancepay/contracts?limit=101");
    expect(invalidLimit.status).toBe(400);
    expect(invalidLimit.body.error.code).toBe("INVALID_LIMIT");
  });

  it("exposes the seeded contracts store for tests", () => {
    seedContract({ id: "contract-1" });
    expect(__getContracts().has("contract-1")).toBe(true);
  });
});