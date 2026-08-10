import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContractor,
  __resetContractors,
  __getAuditLog,
} from "../routes/lancepay.contractors.update.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("PATCH /lancepay/contractors/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
  });

  it("updates a single field successfully", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Old Name",
      email: "old@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ name: "New Name" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("New Name");
    expect(res.body.changed).toBe(true);
    expect(res.body.changedFields).toContain("name");
  });

  it("updates multiple fields at once", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Original",
      email: "original@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({
        name: "Updated",
        email: "updated@example.com",
        country: "CA",
      });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.changedFields.sort()).toEqual(["country", "email", "name"].sort());
    expect(res.body.data.name).toBe("Updated");
    expect(res.body.data.email).toBe("updated@example.com");
    expect(res.body.data.country).toBe("CA");
  });

  it("returns 404 for unknown contractor", async () => {
    const res = await request(app)
      .patch("/lancepay/contractors/unknown")
      .send({ name: "New Name" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("ignores no-op updates", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Same Name",
      email: "same@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ name: "Same Name" });

    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.changedFields).toEqual([]);
  });

  it("validates email format", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ email: "invalid-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EMAIL");
  });

  it("accepts valid email formats", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const validEmails = [
      "user@domain.com",
      "first.last@domain.co.uk",
      "user+tag@domain.org",
    ];

    for (const email of validEmails) {
      __resetContractors();
      __seedContractor({
        id: "con-1",
        workspaceId: "ws-1",
        name: "Test",
        email: "old@example.com",
        country: "US",
        contractType: "fixed",
        status: "active",
        updatedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .patch("/lancepay/contractors/con-1")
        .send({ email });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(email);
    }
  });

  it("validates contract type values", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ contractType: "invalid" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_TYPE");
  });

  it("accepts all valid contract types", async () => {
    const validTypes = ["fixed", "hourly", "retainer", "project"];

    for (const contractType of validTypes) {
      __resetContractors();
      __seedContractor({
        id: "con-1",
        workspaceId: "ws-1",
        name: "Test",
        email: "test@example.com",
        country: "US",
        contractType: "fixed",
        status: "active",
        updatedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .patch("/lancepay/contractors/con-1")
        .send({ contractType });

      expect(res.status).toBe(200);
      expect(res.body.data.contractType).toBe(contractType);
    }
  });

  it("normalizes contract type to lowercase", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ contractType: "HOURLY" });

    expect(res.status).toBe(200);
    expect(res.body.data.contractType).toBe("hourly");
  });

  it("rejects empty name", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ name: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_NAME");
  });

  it("rejects empty country", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ country: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COUNTRY");
  });

  it("emits audit event with changed fields", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Original",
      email: "original@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({
        name: "Updated",
        email: "updated@example.com",
        performedBy: "admin-1",
      });

    const audit = __getAuditLog();
    expect(audit.length).toBe(1);
    expect(audit[0].contractorId).toBe("con-1");
    expect(audit[0].action).toBe("update");
    expect(audit[0].performedBy).toBe("admin-1");
    expect(audit[0].changedFields.sort()).toEqual(["email", "name"].sort());
  });

  it("does not emit audit event for no-op update", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Same",
      email: "same@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ name: "Same" });

    const audit = __getAuditLog();
    expect(audit.length).toBe(0);
  });

  it("returns 400 for empty contractor id", async () => {
    const res = await request(app)
      .patch("/lancepay/contractors/   ")
      .send({ name: "Test" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACTOR_ID");
  });

  it("trims whitespace from updates", async () => {
    __seedContractor({
      id: "con-1",
      workspaceId: "ws-1",
      name: "Test",
      email: "test@example.com",
      country: "US",
      contractType: "fixed",
      status: "active",
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .patch("/lancepay/contractors/con-1")
      .send({ name: "  Trimmed Name  ", country: "  CA  " });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Trimmed Name");
    expect(res.body.data.country).toBe("CA");
  });
});
