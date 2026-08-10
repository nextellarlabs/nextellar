import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import anchorsDisputeRouter, {
  __resetDisputeStore,
} from "../routes/anchors.dispute.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(anchorsDisputeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

const VALID_BODY = {
  anchorTransactionId: "anchor-tx-001",
  reasonCode: "TRANSACTION_NOT_RECEIVED",
};

const AUTH_HEADERS = {
  "x-user-id": "user-abc",
  "x-fresh-auth": "true",
};

beforeEach(() => {
  __resetDisputeStore();
});

describe("POST /anchors/dispute – open dispute", () => {
  it("opens a dispute and returns the dispute record", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(/^dispute-/);
    expect(res.body.data.status).toBe("open");
    expect(res.body.data.reasonCode).toBe("TRANSACTION_NOT_RECEIVED");
    expect(res.body.data.anchorTransactionId).toBe("anchor-tx-001");
    expect(res.body.data.userId).toBe("user-abc");
    expect(res.body.data.openedAt).toBeDefined();
  });

  it("accepts all valid reason codes", async () => {
    const codes = [
      "TRANSACTION_NOT_RECEIVED",
      "INCORRECT_AMOUNT",
      "DUPLICATE_TRANSACTION",
      "UNAUTHORIZED_TRANSACTION",
      "ANCHOR_TIMEOUT",
    ];

    for (const reasonCode of codes) {
      __resetDisputeStore();
      const res = await request(app)
        .post("/anchors/dispute")
        .set(AUTH_HEADERS)
        .send({ ...VALID_BODY, reasonCode });
      expect(res.status).toBe(201);
    }
  });
});

describe("POST /anchors/dispute – duplicate", () => {
  it("rejects a second dispute for the same transaction", async () => {
    await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send(VALID_BODY);

    const res = await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_DISPUTE");
  });

  it("allows different users to dispute the same transaction id", async () => {
    await request(app)
      .post("/anchors/dispute")
      .set({ "x-user-id": "user-1", "x-fresh-auth": "true" })
      .send(VALID_BODY);

    const res = await request(app)
      .post("/anchors/dispute")
      .set({ "x-user-id": "user-2", "x-fresh-auth": "true" })
      .send(VALID_BODY);

    expect(res.status).toBe(201);
  });
});

describe("POST /anchors/dispute – invalid reason", () => {
  it("rejects unknown reason code", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send({ ...VALID_BODY, reasonCode: "WRONG_CODE" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REASON_CODE");
  });

  it("rejects missing reason code", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send({ anchorTransactionId: "tx-001" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REASON_CODE");
  });

  it("rejects missing x-user-id", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set("x-fresh-auth", "true")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects missing fresh auth header", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set("x-user-id", "user-abc")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("FRESH_AUTH_REQUIRED");
  });

  it("rejects missing anchorTransactionId", async () => {
    const res = await request(app)
      .post("/anchors/dispute")
      .set(AUTH_HEADERS)
      .send({ reasonCode: "ANCHOR_TIMEOUT" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TRANSACTION_ID");
  });
});
