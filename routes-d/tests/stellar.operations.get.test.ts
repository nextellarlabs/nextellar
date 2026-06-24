import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import stellarOperationsRouter, {
  __resetOperations,
  __seedOperations,
} from "../routes/stellar.operations.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stellarOperationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

function makeOp(id: string, txHash: string) {
  return {
    id,
    type: "payment",
    sourceAccount: "GABCDEF",
    transactionHash: txHash,
    createdAt: "2024-01-01T00:00:00Z",
    details: { amount: "100" },
  };
}

describe("GET /stellar/operations/:txHash", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetOperations();
  });

  it("returns a single operation for a known transaction", async () => {
    const op = makeOp("op-1", "txhash-abc");
    __seedOperations("txhash-abc", [op]);

    const res = await request(app).get("/stellar/operations/txhash-abc");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.operations).toHaveLength(1);
    expect(res.body.data.operations[0].id).toBe("op-1");
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.cursor).toBeNull();
  });

  it("paginates when there are many operations", async () => {
    const ops = Array.from({ length: 15 }, (_, i) =>
      makeOp(`op-${i}`, "txhash-many"),
    );
    __seedOperations("txhash-many", ops);

    const first = await request(app)
      .get("/stellar/operations/txhash-many")
      .query({ limit: "5" });

    expect(first.status).toBe(200);
    expect(first.body.data.operations).toHaveLength(5);
    expect(first.body.data.hasMore).toBe(true);
    expect(first.body.data.cursor).toBe("op-4");

    const second = await request(app)
      .get("/stellar/operations/txhash-many")
      .query({ limit: "5", cursor: "op-4" });

    expect(second.status).toBe(200);
    expect(second.body.data.operations).toHaveLength(5);
    expect(second.body.data.operations[0].id).toBe("op-5");
    expect(second.body.data.hasMore).toBe(true);

    const third = await request(app)
      .get("/stellar/operations/txhash-many")
      .query({ limit: "5", cursor: "op-9" });

    expect(third.status).toBe(200);
    expect(third.body.data.operations).toHaveLength(5);
    expect(third.body.data.hasMore).toBe(false);
    expect(third.body.data.cursor).toBeNull();
  });

  it("returns 404 for an unknown transaction hash", async () => {
    const res = await request(app).get("/stellar/operations/unknown-hash");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  });

  it("returns 400 for an invalid cursor", async () => {
    __seedOperations("txhash-abc", [makeOp("op-1", "txhash-abc")]);

    const res = await request(app)
      .get("/stellar/operations/txhash-abc")
      .query({ cursor: "nonexistent" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  it("uses default limit when none is provided", async () => {
    const ops = Array.from({ length: 12 }, (_, i) =>
      makeOp(`op-${i}`, "txhash-default"),
    );
    __seedOperations("txhash-default", ops);

    const res = await request(app).get("/stellar/operations/txhash-default");

    expect(res.status).toBe(200);
    expect(res.body.data.operations).toHaveLength(10);
    expect(res.body.data.hasMore).toBe(true);
  });
});
