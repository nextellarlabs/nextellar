import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContract,
  __getContract,
  __resetContracts,
} from "../routes/lancepay.contracts.amend.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const BASE_CONTRACT = {
  id: "contract-1",
  workspaceId: "ws-1",
  contractorId: "con-1",
  currentVersion: 1,
  rate: 100,
  scope: "Full-stack development",
  term: "12 months",
  history: [
    {
      version: 1,
      rate: 100,
      scope: "Full-stack development",
      term: "12 months",
      amendedBy: "ws-1",
      amendedAt: "2026-01-01T00:00:00Z",
    },
  ],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("POST /lancepay/contracts/:id/amend", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContracts();
    __seedContract(BASE_CONTRACT);
  });

  it("amends scope without requiring co-signature", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", scope: "Backend development" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract.scope).toBe("Backend development");
    expect(res.body.data.amendment.version).toBe(2);
  });

  it("amends term without requiring co-signature", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", term: "6 months" });
    expect(res.status).toBe(200);
    expect(res.body.data.contract.term).toBe("6 months");
  });

  it("returns 422 when rate is changed without co-signature", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", rate: 150 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CO_SIGNATURE_REQUIRED");
  });

  it("amends rate when co-signature is provided", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", rate: 150, coSignedBy: "con-1" });
    expect(res.status).toBe(200);
    expect(res.body.data.contract.rate).toBe(150);
    expect(res.body.data.amendment.coSignedBy).toBe("con-1");
  });

  it("preserves version history on each amendment", async () => {
    await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", scope: "Backend development" });

    await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", term: "6 months" });

    const contract = __getContract("contract-1")!;
    expect(contract.history).toHaveLength(3); // original + 2 amendments
    expect(contract.currentVersion).toBe(3);
  });

  it("returns 404 for unknown contract id", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/nonexistent/amend")
      .send({ amendedBy: "ws-1", scope: "New scope" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when no fields are provided", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_CHANGES");
  });

  it("returns 400 when amendedBy is missing", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ scope: "New scope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMENDED_BY");
  });

  it("includes historyCount in response", async () => {
    const res = await request(app)
      .post("/lancepay/contracts/contract-1/amend")
      .send({ amendedBy: "ws-1", scope: "Updated scope" });
    expect(res.body.data.historyCount).toBe(2);
  });
});
