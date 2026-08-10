import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getSessions,
  __resetSessions,
  __seedSession,
} from "../routes/lancepay.contractors.onboarding.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/contractors/:id/onboarding", () => {
  const app = buildApp();

  beforeEach(() => __resetSessions());

  it("starts a new onboarding session and returns 201", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/onboarding")
      .send({ contractorId: "con-1" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("sessionToken");
    expect(res.body.data.steps).toHaveLength(4);
    expect(res.body.data.currentStep).toBe("personal_info");
    expect(res.body.data.isComplete).toBe(false);
  });

  it("returns existing session when contractor already started onboarding", async () => {
    const first = await request(app)
      .post("/lancepay/contractors/con-1/onboarding")
      .send({ contractorId: "con-1" });
    const sessionId = first.body.data.id;

    const second = await request(app)
      .post("/lancepay/contractors/con-1/onboarding")
      .send({ contractorId: "con-1" });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(sessionId);
    expect(second.body.data.resumed).toBeUndefined(); // from data, not top-level
    expect(second.body.resumed).toBe(true);
  });

  it("resumes session with sessionToken", async () => {
    const start = await request(app)
      .post("/lancepay/contractors/con-2/onboarding")
      .send({ contractorId: "con-2" });
    const { sessionToken } = start.body.data;

    const resume = await request(app)
      .post("/lancepay/contractors/con-2/onboarding")
      .send({ sessionToken });
    expect(resume.status).toBe(200);
    expect(resume.body.resumed).toBe(true);
  });

  it("marks a step complete when completeStep is provided", async () => {
    const start = await request(app)
      .post("/lancepay/contractors/con-3/onboarding")
      .send({ contractorId: "con-3" });
    const { sessionToken } = start.body.data;

    const res = await request(app)
      .post("/lancepay/contractors/con-3/onboarding")
      .send({ sessionToken, completeStep: "personal_info" });
    expect(res.status).toBe(200);
    const personalInfo = res.body.data.steps.find((s: { step: string }) => s.step === "personal_info");
    expect(personalInfo.status).toBe("completed");
    expect(res.body.data.currentStep).toBe("kyc");
  });

  it("marks session complete when all steps are done", async () => {
    const start = await request(app)
      .post("/lancepay/contractors/con-4/onboarding")
      .send({ contractorId: "con-4" });
    let { sessionToken } = start.body.data;

    for (const step of ["personal_info", "kyc", "wallet_link", "tax_form"]) {
      const r = await request(app)
        .post("/lancepay/contractors/con-4/onboarding")
        .send({ sessionToken, completeStep: step });
      expect(r.status).toBe(200);
    }

    const sessions = __getSessions();
    const session = [...sessions.values()].find((s) => s.contractorId === "con-4")!;
    expect(session.isComplete).toBe(true);
    expect(session.currentStep).toBe("complete");
  });

  it("returns 404 for invalid sessionToken", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/onboarding")
      .send({ sessionToken: "invalid-token-xyz" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVALID_SESSION_TOKEN");
  });

  it("returns 400 for unknown completeStep", async () => {
    const start = await request(app)
      .post("/lancepay/contractors/con-5/onboarding")
      .send({ contractorId: "con-5" });
    const { sessionToken } = start.body.data;

    const res = await request(app)
      .post("/lancepay/contractors/con-5/onboarding")
      .send({ sessionToken, completeStep: "not_a_real_step" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STEP");
  });
});
