import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContractor,
  __resetContractors,
  __getContractors,
} from "../routes/lancepay.contractors.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/contractors", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
  });

  it("returns empty list when no contractors exist", async () => {
    const res = await request(app).get("/lancepay/contractors");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns all contractors when no filters applied", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Alice",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "Bob",
      status: "active",
      country: "CA",
      contractType: "hourly",
      lastActivityAt: new Date(Date.now() - 2000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("filters by status", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Active Contractor",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "Inactive Contractor",
      status: "inactive",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors?status=active");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe("active");
  });

  it("filters by country", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "US Contractor",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "CA Contractor",
      status: "active",
      country: "CA",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors?country=CA");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].country).toBe("CA");
  });

  it("filters by contractType", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Fixed Rate",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "Hourly Rate",
      status: "active",
      country: "US",
      contractType: "hourly",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors?contractType=hourly");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].contractType).toBe("hourly");
  });

  it("sorts by recent activity descending", async () => {
    const now = Date.now();
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "First",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date(now - 3000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "Second",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date(now - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors");
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("con-2");
    expect(res.body.data[1].id).toBe("con-1");
  });

  it("paginates results", async () => {
    for (let i = 1; i <= 25; i++) {
      __seedContractor({
        id: `con-${i}`,
        workspaceId: "ws-1",
        name: `Contractor ${i}`,
        status: "active",
        country: "US",
        contractType: "fixed",
        lastActivityAt: new Date(Date.now() - i * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    const page1 = await request(app).get("/lancepay/contractors?page=1&limit=10");
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(10);
    expect(page1.body.pagination.page).toBe(1);
    expect(page1.body.pagination.limit).toBe(10);
    expect(page1.body.pagination.total).toBe(25);
    expect(page1.body.pagination.hasNext).toBe(true);

    const page2 = await request(app).get("/lancepay/contractors?page=2&limit=10");
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(10);
    expect(page2.body.pagination.page).toBe(2);
    expect(page2.body.pagination.hasNext).toBe(true);

    const page3 = await request(app).get("/lancepay/contractors?page=3&limit=10");
    expect(page3.status).toBe(200);
    expect(page3.body.data.length).toBe(5);
    expect(page3.body.pagination.hasNext).toBe(false);
  });

  it("returns 400 for invalid page", async () => {
    const res = await request(app).get("/lancepay/contractors?page=0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("returns 400 for invalid limit", async () => {
    const res = await request(app).get("/lancepay/contractors?limit=101");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("combines multiple filters", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Match",
      status: "active",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedContractor({
      id: "con-2",
      workspaceId: "ws-1",
      name: "No Match",
      status: "inactive",
      country: "US",
      contractType: "fixed",
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get(
      "/lancepay/contractors?status=active&country=US&contractType=fixed",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("con-1");
  });
});
