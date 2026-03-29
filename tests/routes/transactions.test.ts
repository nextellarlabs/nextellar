import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import transactionsRouter from "../../backend/routes/transactions.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(transactionsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /transactions", () => {
  const app = buildApp();

  it("returns 200 with valid JSON content type", async () => {
    const res = await request(app)
      .post("/transactions")
      .set("Content-Type", "application/json")
      .send({ amount: "100", destination: "GABC123", memo: "test" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 415 for text/plain content type", async () => {
    const res = await request(app)
      .post("/transactions")
      .set("Content-Type", "text/plain")
      .send("some plain text");

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Unsupported Media Type");
  });

  it("returns 415 when Content-Type header is missing", async () => {
    const res = await request(app)
      .post("/transactions")
      .unset("Content-Type")
      .send();

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("application/json");
  });

  it("returns 415 for multipart/form-data content type", async () => {
    const res = await request(app)
      .post("/transactions")
      .set("Content-Type", "multipart/form-data; boundary=---")
      .send("---\r\nContent-Disposition: form-data\r\n---");

    expect(res.status).toBe(415);
    expect(res.body.success).toBe(false);
  });

  it("accepts application/json with charset parameter", async () => {
    const res = await request(app)
      .post("/transactions")
      .set("Content-Type", "application/json; charset=utf-8")
      .send({ amount: "50", destination: "GXYZ456" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
