import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedInvite, __getInvite, __resetInviteStore } from "../routes/lancepay.org.members.invite.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/organizations/:id/members/invite", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetInviteStore();
  });

  it("creates a single-use signed invite link", async () => {
    const res = await request(app)
      .post("/lancepay/organizations/org1/members/invite")
      .set("x-caller-id", "admin1")
      .set("x-caller-role", "admin")
      .send({ email: "dev@example.com", role: "member" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.inviteUrl).toContain("https://lancepay.app/invite/accept?token=");
    expect(res.body.data.email).toBe("dev@example.com");

    const invite = __getInvite(res.body.data.token);
    expect(invite).toBeDefined();
    expect(invite?.invitedBy).toBe("admin1");
  });

  it("returns 403 when caller is not owner or admin", async () => {
    const res = await request(app)
      .post("/lancepay/organizations/org1/members/invite")
      .set("x-caller-id", "user1")
      .set("x-caller-role", "member")
      .send({ email: "dev@example.com" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("detects expired invite link during verification", async () => {
    __seedInvite({
      id: "inv1",
      orgId: "org1",
      email: "old@example.com",
      role: "member",
      token: "exp_token",
      inviteUrl: "http://...",
      expiresAt: Date.now() - 1000,
      used: false,
      invitedBy: "admin1",
    });

    const res = await request(app)
      .get("/lancepay/organizations/invites/verify")
      .query({ token: "exp_token" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXPIRED");
  });
});
