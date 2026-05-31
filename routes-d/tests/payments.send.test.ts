import express, { type Express } from "express";
import request from "supertest";
import { createPaymentSendRouter } from "../routes/payments.send.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/payments", createPaymentSendRouter());
  return app;
}

describe("POST /payments/send", () => {
  it("returns an envelope when amount and destination are valid", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/payments/send")
      .send({
        destination: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678",
        amount: "10.5",
        assetCode: "XLM",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.envelope).toMatch(/envelope_payment/);
  });

  it("returns field errors for invalid amounts", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/payments/send")
      .send({
        destination: "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678",
        amount: "0",
        assetCode: "XLM",
      });
    expect(res.status).toBe(400);
    expect(res.body.errors?.[0]?.field).toBe("amount");
  });
});
