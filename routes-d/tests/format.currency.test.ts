import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import formatCurrencyRouter from "../routes/format.currency.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(formatCurrencyRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe("Currency Display Formatting Route Handlers", () => {
  const app = buildApp();

  describe("POST /format/currency", () => {
    it("formats USD currency successfully", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: 2500.5,
          currency: "USD",
          locale: "en-US",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formatted).toBe("$2,500.50");
      expect(res.body.data.amount).toBe(2500.5);
      expect(res.body.data.currency).toBe("USD");
    });

    it("formats Stellar native XLM successfully", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: 0.0000001,
          currency: "XLM",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formatted).toBe("0.0000001 XLM");
      expect(res.body.data.isNative).toBe(true);
    });

    it("rejects unknown currency code with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: 100,
          currency: "NON_EXISTENT_CODE",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("UNKNOWN_CURRENCY");
    });

    it("returns 400 when missing amount field", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          currency: "USD",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when missing currency field", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: 100,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid amount parameter", async () => {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: "invalid-number",
          currency: "USD",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_AMOUNT");
    });
  });

  describe("GET /format/currency", () => {
    it("formats currency via query parameters", async () => {
      const res = await request(app)
        .get("/format/currency?amount=500&currency=EUR&locale=de-DE");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formatted).toContain("500,00");
    });
  });
});
