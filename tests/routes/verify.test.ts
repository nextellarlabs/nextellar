import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import verifyRouter, { verifyDeps } from "../../backend/routes/verify";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(verifyRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /verify", () => {
  const app = buildApp();
  let onVerificationFailureMock: jest.MockedFunction<
    typeof verifyDeps.onVerificationFailure
  >;

  beforeEach(() => {
    onVerificationFailureMock = jest.fn().mockResolvedValue(undefined);
    verifyDeps.onVerificationFailure = onVerificationFailureMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns immediately on successful verification (no fall-through)", async () => {
    const res = await request(app)
      .post("/verify")
      .send({ code: "123456", storedCode: "123456" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
    expect(onVerificationFailureMock).not.toHaveBeenCalled();
  });

  it("returns 401 for mismatched verification code", async () => {
    const res = await request(app)
      .post("/verify")
      .send({ code: "111111", storedCode: "222222" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ verified: false });
    expect(onVerificationFailureMock).toHaveBeenCalledTimes(1);
  });
});
