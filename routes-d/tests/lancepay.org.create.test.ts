import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __resetOrganizations, __seedOrganization } from "../routes/lancepay.org.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/organizations", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetOrganizations();
  });

  it("creates an organization with a valid payload", async () => {
    const res = await request(app).post("/lancepay/organizations").send({
      name: "Acme Labs",
      jurisdiction: "US-CA",
      fundingWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      ownerId: "user-1",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Acme Labs");
    expect(res.body.data.ownerId).toBe("user-1");
    expect(res.body.data.status).toBe("active");
  });

  it("rejects duplicate organization names within the same owner context", async () => {
    __seedOrganization({
      id: "org-existing",
      name: "Acme Labs",
      jurisdiction: "US-CA",
      fundingWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      ownerId: "user-1",
      status: "active",
    });

    const res = await request(app).post("/lancepay/organizations").send({
      name: "acme labs",
      jurisdiction: "US-CA",
      fundingWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      ownerId: "user-2",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NAME_ALREADY_EXISTS");
  });

  it("fails validation for an invalid funding wallet", async () => {
    const res = await request(app).post("/lancepay/organizations").send({
      name: "Acme Labs",
      jurisdiction: "US-CA",
      fundingWallet: "not-a-wallet",
      ownerId: "user-1",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FUNDING_WALLET");
  });
});
