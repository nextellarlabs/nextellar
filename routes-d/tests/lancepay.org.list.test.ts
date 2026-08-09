import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedUserOrganizations, __resetUserOrganizations } from "../routes/lancepay.org.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/organizations", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetUserOrganizations();
  });

  it("returns 401 when user identity is missing", async () => {
    const res = await request(app).get("/lancepay/organizations");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns empty organization list for user with no orgs", async () => {
    const res = await request(app)
      .get("/lancepay/organizations")
      .set("x-user-id", "user_none");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.organizations).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("returns single organization with active mark for user with one org", async () => {
    __seedUserOrganizations("user_one", [
      { id: "org_1", name: "Acme Corp", slug: "acme", role: "owner", isActive: false },
    ]);

    const res = await request(app)
      .get("/lancepay/organizations")
      .set("x-user-id", "user_one");

    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toHaveLength(1);
    expect(res.body.data.organizations[0].isActive).toBe(true);
    expect(res.body.data.organizations[0].role).toBe("owner");
  });

  it("returns multiple organizations marking specified activeOrgId", async () => {
    __seedUserOrganizations("user_many", [
      { id: "org_1", name: "Alpha", slug: "alpha", role: "owner", isActive: false },
      { id: "org_2", name: "Beta", slug: "beta", role: "member", isActive: false },
      { id: "org_3", name: "Gamma", slug: "gamma", role: "admin", isActive: false },
    ]);

    const res = await request(app)
      .get("/lancepay/organizations")
      .set("x-user-id", "user_many")
      .set("x-active-org-id", "org_2");

    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toHaveLength(3);
    expect(res.body.data.organizations[1].id).toBe("org_2");
    expect(res.body.data.organizations[1].isActive).toBe(true);
    expect(res.body.data.organizations[0].isActive).toBe(false);
    expect(res.body.data.activeOrgId).toBe("org_2");
  });
});
