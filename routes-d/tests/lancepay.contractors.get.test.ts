import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContractor,
  __resetContractors,
} from "../routes/lancepay.contractors.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/contractors/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
  });

  it("returns contractor details for valid request", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "John Doe",
      email: "john@example.com",
      phone: "555-1234",
      status: "active",
      country: "US",
      contractType: "fixed",
      payoutStatus: "verified",
      complianceStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/contractors/con-1")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("con-1");
    expect(res.body.data.name).toBe("John Doe");
    expect(res.body.data.status).toBe("active");
  });

  it("hides email and phone from non-admin users", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "555-5678",
      status: "active",
      country: "US",
      contractType: "fixed",
      payoutStatus: "verified",
      complianceStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/contractors/con-1")
      .set("x-workspace-id", "ws-1")
      .set("x-role", "member");

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("email");
    expect(res.body.data).not.toHaveProperty("phone");
  });

  it("reveals email and phone to admin users", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Admin View",
      email: "admin@example.com",
      phone: "555-9999",
      status: "active",
      country: "US",
      contractType: "fixed",
      payoutStatus: "verified",
      complianceStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/contractors/con-1")
      .set("x-workspace-id", "ws-1")
      .set("x-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("admin@example.com");
    expect(res.body.data.phone).toBe("555-9999");
  });

  it("returns 404 for unknown contractor", async () => {
    const res = await request(app)
      .get("/lancepay/contractors/unknown-id")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 403 for cross-workspace access", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Private",
      email: "private@example.com",
      phone: "555-0000",
      status: "active",
      country: "US",
      contractType: "fixed",
      payoutStatus: "verified",
      complianceStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/contractors/con-1")
      .set("x-workspace-id", "ws-2");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when workspace header is missing", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      phone: "555-1111",
      status: "active",
      country: "US",
      contractType: "fixed",
      payoutStatus: "verified",
      complianceStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get("/lancepay/contractors/con-1");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_WORKSPACE");
  });

  it("returns 400 for empty contractor id", async () => {
    const res = await request(app)
      .get("/lancepay/contractors/  ")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACTOR_ID");
  });
});
