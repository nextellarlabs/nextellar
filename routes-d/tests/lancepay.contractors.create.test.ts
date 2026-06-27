import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContractor,
  __resetContractors,
  __getContractors,
} from "../routes/lancepay.contractors.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = {
  name: "Alice Nakamura",
  email: "alice@example.com",
  taxId: "US-123456789",
  payoutWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  homeJurisdiction: "US",
  contractType: "fixed",
};

describe("POST /lancepay/contractors", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
  });

  it("creates a contractor profile with valid data", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.name).toBe("Alice Nakamura");
    expect(res.body.data.email).toBe("alice@example.com");
    expect(res.body.data.workspaceId).toBe("ws-1");
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.payoutWallet).toBe(VALID_BODY.payoutWallet);
    expect(res.body.data.homeJurisdiction).toBe("US");
    expect(res.body.data.contractType).toBe("fixed");
    expect(__getContractors().size).toBe(1);
  });

  it("returns 401 when x-workspace-id header is missing", async () => {
    const res = await request(app).post("/lancepay/contractors").send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_WORKSPACE");
  });

  it("returns 400 when name is missing", async () => {
    const { name: _n, ...rest } = VALID_BODY;
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_NAME");
  });

  it("returns 400 when email is invalid", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send({ ...VALID_BODY, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EMAIL");
  });

  it("returns 400 when taxId is missing", async () => {
    const { taxId: _t, ...rest } = VALID_BODY;
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TAX_ID");
  });

  it("returns 400 when payoutWallet is invalid", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send({ ...VALID_BODY, payoutWallet: "not-a-stellar-key" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAYOUT_WALLET");
  });

  it("returns 400 when homeJurisdiction is missing", async () => {
    const { homeJurisdiction: _h, ...rest } = VALID_BODY;
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_HOME_JURISDICTION");
  });

  it("returns 400 when contractType is unsupported", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send({ ...VALID_BODY, contractType: "retainer" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_TYPE");
  });

  it("returns 409 on duplicate email within the same workspace", async () => {
    await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(VALID_BODY);

    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_IDENTIFIER");
    expect(__getContractors().size).toBe(1);
  });

  it("allows the same email in a different workspace", async () => {
    const first = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send(VALID_BODY);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-2")
      .send(VALID_BODY);
    expect(second.status).toBe(201);
    expect(second.body.data.workspaceId).toBe("ws-2");
    expect(__getContractors().size).toBe(2);
  });

  it("normalises email to lowercase", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-1")
      .send({ ...VALID_BODY, email: "ALICE@EXAMPLE.COM" });
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("alice@example.com");
  });

  it("persists contractor bound to the calling workspace only", async () => {
    const res = await request(app)
      .post("/lancepay/contractors")
      .set("x-workspace-id", "ws-99")
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    const created = res.body.data;
    expect(created.workspaceId).toBe("ws-99");
    const stored = __getContractors().get(created.id)!;
    expect(stored.workspaceId).toBe("ws-99");
  });
});
