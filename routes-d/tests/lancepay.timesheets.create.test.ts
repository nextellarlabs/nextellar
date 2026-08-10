import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getTimesheets,
  __resetTimesheets,
} from "../routes/lancepay.timesheets.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = {
  contractorId: "con-1",
  payPeriodStart: "2026-07-01",
  payPeriodEnd: "2026-07-07",
  entries: [
    { date: "2026-07-01", hours: 8, projectCode: "PROJ-1" },
    { date: "2026-07-03", hours: 6.5, projectCode: "PROJ-2" },
  ],
};

describe("POST /lancepay/timesheets", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTimesheets();
  });

  it("submits a valid timesheet for a pay period", async () => {
    const res = await request(app).post("/lancepay/timesheets").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contractorId).toBe("con-1");
    expect(res.body.data.entries).toHaveLength(2);
    expect(__getTimesheets()).toHaveLength(1);
  });

  it("rejects duplicate submissions for the same contractor and period", async () => {
    await request(app).post("/lancepay/timesheets").send(VALID_BODY);

    const res = await request(app).post("/lancepay/timesheets").send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_SUBMISSION");
  });

  it("rejects entries that fall outside the pay-period bounds", async () => {
    const res = await request(app)
      .post("/lancepay/timesheets")
      .send({
        ...VALID_BODY,
        entries: [
          { date: "2026-06-30", hours: 8, projectCode: "PROJ-1" },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OUT_OF_PERIOD_ENTRY");
  });
});
