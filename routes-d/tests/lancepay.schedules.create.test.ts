import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getSchedules,
  __resetSchedules,
} from "../routes/lancepay.schedules.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const VALID_BODY = {
  workspaceId: "ws-1",
  contractorId: "con-1",
  cadence: "monthly",
  amount: 3000,
  currency: "USD",
  nextPayDate: FUTURE_DATE,
};

describe("POST /lancepay/schedules", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSchedules();
  });

  it("creates a schedule with valid data", async () => {
    const res = await request(app).post("/lancepay/schedules").send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.cadence).toBe("monthly");
  });

  it("accepts all valid cadences", async () => {
    for (const cadence of ["weekly", "biweekly", "monthly", "quarterly"]) {
      __resetSchedules();
      const res = await request(app)
        .post("/lancepay/schedules")
        .send({ ...VALID_BODY, cadence });
      expect(res.status).toBe(201);
      expect(res.body.data.cadence).toBe(cadence);
    }
  });

  it("returns 400 for invalid cadence", async () => {
    const res = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, cadence: "daily" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CADENCE");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when nextPayDate is missing", async () => {
    const { nextPayDate: _d, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/schedules").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_NEXT_PAY_DATE");
  });

  it("returns 400 when nextPayDate is not a valid ISO date", async () => {
    const res = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, nextPayDate: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_NEXT_PAY_DATE");
  });

  it("returns 400 when nextPayDate is in the past", async () => {
    const res = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, nextPayDate: "2020-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_NEXT_PAY_DATE");
  });

  it("returns idempotent response on duplicate idempotency key", async () => {
    const first = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, idempotencyKey: "idem-sched-1" });
    expect(first.status).toBe(201);
    const schedId = first.body.data.id;

    const second = await request(app)
      .post("/lancepay/schedules")
      .send({ ...VALID_BODY, idempotencyKey: "idem-sched-1" });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.data.id).toBe(schedId);
    expect(__getSchedules().size).toBe(1);
  });
});
