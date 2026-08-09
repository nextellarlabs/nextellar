import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import formatCurrencyRouter from "../../routes/format.currency.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(formatCurrencyRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe("Currency Display Formatting Integration", () => {
  const app = buildApp();

  it("handles multi-currency and locale formatting across well-known pairs and Stellar assets", async () => {
    const testCases = [
      { amount: 1000, currency: "USD", locale: "en-US", expectedSub: "$1,000.00" },
      { amount: 1000, currency: "EUR", locale: "fr-FR", expectedSub: "1 000,00" },
      { amount: 5000, currency: "JPY", locale: "ja-JP", expectedSub: "5,000" },
      { amount: 10.5, currency: "XLM", locale: "en-US", expectedSub: "10.5 XLM" },
      { amount: 0.0000001, currency: "native", locale: "en-US", expectedSub: "0.0000001 XLM" },
    ];

    for (const tc of testCases) {
      const res = await request(app)
        .post("/format/currency")
        .send({
          amount: tc.amount,
          currency: tc.currency,
          locale: tc.locale,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formatted).toContain(tc.expectedSub);
    }
  });
});
