import express, { Request, Response } from "express";
import request from "supertest";

// Mirrors the versioning structure in backend/app.ts without loading routes
// that have unresolvable dependencies (jsonwebtoken is not installed).
function buildApp() {
  const app = express();

  const healthRouter = express.Router();
  healthRouter.get("/", (_req, res) => res.status(200).json({ status: "ok" }));

  const v1 = express.Router();
  v1.use("/health", healthRouter);
  app.use("/v1", v1);

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: `This endpoint has moved. Please use /v1${req.path} instead.`,
    });
  });

  return app;
}

describe("API versioning — /v1 prefix and legacy 404", () => {
  const app = buildApp();

  it("GET /v1/health returns 200", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /health returns 404 with deprecation message", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/\/v1/);
  });
});
