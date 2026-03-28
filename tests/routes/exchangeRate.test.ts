import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = globalThis.fetch;

function buildApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /exchange-rate", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, EXCHANGE_RATE_TIMEOUT_MS: "25" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
    jest.clearAllMocks();
  });

  it("returns 504 when upstream call exceeds timeout", async () => {
    globalThis.fetch = jest.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("Request aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    ) as unknown as typeof fetch;

    const { default: exchangeRateRouter } = await import(
      "../../backend/routes/exchangeRate"
    );
    const app = buildApp(exchangeRateRouter);

    const res = await request(app).get("/exchange-rate?base=XLM&quote=USD");

    expect(res.status).toBe(504);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Upstream exchange rate request timed out");
  });

  it("returns 200 when upstream responds before timeout", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 0.12 }),
    }) as unknown as typeof fetch;

    const { default: exchangeRateRouter } = await import(
      "../../backend/routes/exchangeRate"
    );
    const app = buildApp(exchangeRateRouter);

    const res = await request(app).get("/exchange-rate?base=XLM&quote=USD");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ base: "XLM", quote: "USD", rate: 0.12 });
  });
});
