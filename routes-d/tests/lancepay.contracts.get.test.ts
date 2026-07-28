import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContract,
  __getContract,
  __resetContracts,
} from "../routes/lancepay.contracts.get.js";

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
  scope: "dev",
  term: "12 months",
  history: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("GET /lancepay/contracts/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContracts();
    __seedContract(BASE_CONTRACT);
  });

  it("returns contract for workspace member", async () => {
    const res = await request(app)
      .get("/lancepay/contracts/contract-1")
      .set("x-workspace-id", "ws-1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("contract-1");
    expect(res.body.data.workspaceId).toBe("ws-1");
  });

  it("returns contract for contractor", async () => {
    const res = await request(app)
      .get("/lancepay/contracts/contract-1")
      .set("x-caller-id", "con-1");
    expect(res.status).toBe(200);
    expect(res.body.data.contractorId).toBe("con-1");
  });

  it("returns 404 for unknown contract", async () => {
    const res = await request(app)
      .get("/lancepay/contracts/unknown")
      .set("x-workspace-id", "ws-1");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 403 for unauthorized access", async () => {
    const res = await request(app)
      .get("/lancepay/contracts/contract-1")
      .set("x-workspace-id", "ws-2");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when auth headers missing", async () => {
    const res = await request(app).get("/lancepay/contracts/contract-1");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_AUTH");
  });

  it("returns 400 for empty contract id", async () => {
    const res = await request(app)
      .get("/lancepay/contracts/   ")
      .set("x-workspace-id", "ws-1");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACT_ID");
  });
});
