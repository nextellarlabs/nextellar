import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import screenRouter from "../routes/payments.screen.js";
import {
  __resetAll,
  __setSanctionsList,
  __setSourceError,
  getAuditLog,
} from "../lib/sanctionsScreening.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(screenRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const SANCTIONED_ADDR = "GCANMZYBQSBY4U6UY7V7ZA5P7LG5V6Q6V5PZ5Q6V7A5P7LG5V6Q6V5P";
const CLEAN_ADDR = "GA7OPG4E2Z5Q6V7A5P7LG5V6Q6V5PZ5Q6V7A5P7LG5V6Q6V5PZ5";

describe("POST /payments/screen", () => {
  const app = buildApp();
  const authHeader = { "x-user-id": "user-001" };

  beforeEach(() => {
    __resetAll();
  });

  it("returns 200 with clean status for a non-listed destination", async () => {
    __setSanctionsList([SANCTIONED_ADDR]);

    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: CLEAN_ADDR });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("clean");
    expect(res.body.data.destination).toBe(CLEAN_ADDR);
    expect(res.body.data.timestamp).toBeDefined();
  });

  it("returns 403 with SANCTIONS_HIT for a listed destination", async () => {
    __setSanctionsList([SANCTIONED_ADDR]);

    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: SANCTIONED_ADDR });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SANCTIONS_HIT");
    expect(res.body.error.message).toContain("OFAC_SDN");
  });

  it("returns 503 SCREENING_UNAVAILABLE when the list source is unavailable", async () => {
    __setSourceError(new Error("Source unavailable"));

    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: CLEAN_ADDR });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SCREENING_UNAVAILABLE");
  });

  it("returns 401 UNAUTHORIZED when x-user-id header is missing", async () => {
    const res = await request(app)
      .post("/payments/screen")
      .send({ destination: CLEAN_ADDR });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_DESTINATION when destination is missing", async () => {
    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION");
  });

  it("returns 400 when destination is not a string", async () => {
    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION");
  });

  it("trims whitespace from destination", async () => {
    __setSanctionsList([SANCTIONED_ADDR]);

    const res = await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: `  ${CLEAN_ADDR}  ` });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("clean");
    expect(res.body.data.destination).toBe(CLEAN_ADDR);
  });

  it("records screening in audit log on success", async () => {
    await request(app)
      .post("/payments/screen")
      .set(authHeader)
      .send({ destination: CLEAN_ADDR });

    const log = getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].destination).toBe(CLEAN_ADDR);
    expect(log[0].status).toBe("clean");
  });
});
