import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { globalErrorHandler } from "../middleware/errorHandler.js";

// `routes/export.js` pulls in `auth/token.js`, which reads JWT_SECRET at
// module-load time. Static imports are hoisted above any top-level
// assignment, so the env var must be set before a *dynamic* import
// triggers that module graph to load.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-12345678901234567890123456789012";

async function buildApp() {
  const { default: exportRouter } = await import("../routes/export.js");
  const app = express();
  app.use(express.json());
  app.use("/", exportRouter);
  app.use(globalErrorHandler);
  return app;
}

function signToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    issuer: "nextellar",
    audience: "nextellar-app",
  });
}

describe("GET /export", () => {
  it("returns 200 with exported data when a valid Authorization header is present", async () => {
    const app = await buildApp();
    const token = signToken({ sub: "user-1", role: "user" });

    const res = await request(app)
      .get("/export")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.userId).toBe("user-1");
  });

  it("returns 401 when the Authorization header is absent", async () => {
    const app = await buildApp();

    const res = await request(app).get("/export");

    expect(res.status).toBe(401);
  });

  it("returns 401 when only a ?token= query param is supplied and no header is present", async () => {
    const app = await buildApp();
    const token = signToken({ sub: "user-1", role: "user" });

    const res = await request(app).get("/export").query({ token });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is malformed (not Bearer)", async () => {
    const app = await buildApp();
    const token = signToken({ sub: "user-1", role: "user" });

    const res = await request(app)
      .get("/export")
      .set("Authorization", token);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the Bearer token is invalid", async () => {
    const app = await buildApp();

    const res = await request(app)
      .get("/export")
      .set("Authorization", "Bearer not-a-real-token");

    expect(res.status).toBe(401);
  });

  it("ignores a ?token= query param even when a valid Authorization header is also present, without erroring", async () => {
    const app = await buildApp();
    const token = signToken({ sub: "user-1", role: "user" });

    const res = await request(app)
      .get("/export")
      .query({ token: "some-irrelevant-value" })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe("user-1");
  });
});
