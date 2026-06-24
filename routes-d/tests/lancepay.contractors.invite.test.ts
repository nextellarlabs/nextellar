import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getInvites,
  __resetInvites,
  __seedInvite,
} from "../routes/lancepay.contractors.invite.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = { workspaceId: "ws-1", email: "contractor@example.com" };

describe("POST /lancepay/contractors/:id/invite", () => {
  const app = buildApp();

  beforeEach(() => __resetInvites());

  it("sends a new invite and returns 201", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/invite")
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("token");
    expect(res.body.data).toHaveProperty("link");
    expect(res.body.data.status).toBe("pending");
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/invite")
      .send({ email: "x@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WORKSPACE_ID");
  });

  it("returns 400 when neither email nor phone is provided", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/invite")
      .send({ workspaceId: "ws-1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTACT");
  });

  it("returns 429 when resending too soon", async () => {
    __seedInvite({
      id: "inv-1",
      contractorId: "con-1",
      workspaceId: "ws-1",
      token: "tok",
      link: "https://example.com/invite/tok",
      email: "x@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      lastSentAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago < 1h
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/contractors/con-1/invite")
      .send(VALID_BODY);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RESEND_TOO_SOON");
  });

  it("resends after cooldown and returns 200", async () => {
    __seedInvite({
      id: "inv-2",
      contractorId: "con-2",
      workspaceId: "ws-1",
      token: "tok2",
      link: "https://example.com/invite/tok2",
      email: "x@example.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      lastSentAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2h ago > 1h
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/contractors/con-2/invite")
      .send({ workspaceId: "ws-1", email: "x@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.resent).toBe(true);
  });

  it("generates a unique token per invite", async () => {
    const r1 = await request(app).post("/lancepay/contractors/con-a/invite").send(VALID_BODY);
    const r2 = await request(app).post("/lancepay/contractors/con-b/invite").send(VALID_BODY);
    expect(r1.body.data.token).not.toBe(r2.body.data.token);
  });

  it("accepts phone-only contact", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-3/invite")
      .send({ workspaceId: "ws-1", phone: "+2348012345678" });
    expect(res.status).toBe(201);
  });
});
