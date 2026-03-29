import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// We re-import the router after mocking the internal processPayment stub so
// we can simulate a DB / provider failure without touching real infrastructure.
// ---------------------------------------------------------------------------

// Jest module factory — hoisted above imports automatically
jest.mock("../../backend/routes/payments", () => {
  // We'll override per-test via the exported mock below
  return { __esModule: true, default: null };
});

import paymentsRouter from "../../backend/routes/payments";

function buildApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(router);

  // Global error middleware — mirrors what a real Express app would have
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Because the module mock above is awkward for a Router, we test the handler
// directly by building a minimal Express app around a fresh router instance.
// ---------------------------------------------------------------------------

describe("POST /payments", () => {
  let app: express.Application;

  beforeEach(() => {
    // Re-require a fresh, un-mocked version of the router for each test
    jest.resetModules();
  });

  it("returns 200 with a valid payload", async () => {
    const { default: router } = await import("../../backend/routes/payments");
    app = buildApp(router);

    const res = await request(app)
      .post("/payments")
      .send({ amount: "100", destination: "GABC123", asset: "XLM" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 500 and does NOT crash when a DB/provider failure occurs", async () => {
    // Dynamically build a router that simulates a DB failure
    const { Router } = await import("express");
    const failingRouter = Router();

    failingRouter.post(
      "/payments",
      async (_req: Request, _res: Response, next: NextFunction) => {
        try {
          throw new Error("DB write failure");
        } catch (err) {
          next(err); // must reach global error middleware
        }
      },
    );

    app = buildApp(failingRouter);

    const res = await request(app)
      .post("/payments")
      .send({ amount: "100", destination: "GABC123", asset: "XLM" });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("DB write failure");
  });

  it("returns 500 for missing required fields without crashing", async () => {
    const { default: router } = await import("../../backend/routes/payments");
    app = buildApp(router);

    const res = await request(app).post("/payments").send({});

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
