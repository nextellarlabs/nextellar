import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedMember, __getMember, __getAuditEvents, __resetRoleStore } from "../routes/lancepay.org.members.role.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/organizations/:id/members/role", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetRoleStore();
  });

  it("promotes member role and records audit event", async () => {
    __seedMember({ orgId: "org1", memberId: "mem1", role: "member" });

    const res = await request(app)
      .post("/lancepay/organizations/org1/members/role")
      .set("x-caller-id", "owner1")
      .set("x-caller-role", "owner")
      .send({ memberId: "mem1", newRole: "admin" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.previousRole).toBe("member");
    expect(res.body.data.newRole).toBe("admin");

    const updated = __getMember("org1", "mem1");
    expect(updated?.role).toBe("admin");

    const audits = __getAuditEvents();
    expect(audits).toHaveLength(1);
    expect(audits[0].newRole).toBe("admin");
  });

  it("demotes member role successfully", async () => {
    __seedMember({ orgId: "org1", memberId: "mem1", role: "admin" });

    const res = await request(app)
      .post("/lancepay/organizations/org1/members/role")
      .set("x-caller-id", "admin1")
      .set("x-caller-role", "admin")
      .send({ memberId: "mem1", newRole: "viewer" });

    expect(res.status).toBe(200);
    expect(res.body.data.newRole).toBe("viewer");
  });

  it("rejects unauthorized caller without admin/owner role", async () => {
    const res = await request(app)
      .post("/lancepay/organizations/org1/members/role")
      .set("x-caller-id", "user1")
      .set("x-caller-role", "member")
      .send({ memberId: "mem1", newRole: "admin" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
