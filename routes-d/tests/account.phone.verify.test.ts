import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import phoneVerifyRouter, { __resetPhoneVerify } from "../routes/account.phone.verify.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(phoneVerifyRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /account/phone/verify", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPhoneVerify();
  });

  it("returns 200 and verified=true for valid code", async () => {
    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1234567890", code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.phoneNumber).toBe("+1234567890");
  });

  it("normalizes phone number by removing spaces and dashes", async () => {
    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1 234-567-890", code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.data.phoneNumber).toBe("+1234567890");
  });

  it("returns 400 for invalid code", async () => {
    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1234567890", code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CODE");
  });

  it("returns 400 when phoneNumber is missing", async () => {
    const res = await request(app)
      .post("/account/phone/verify")
      .send({ code: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PHONE_NUMBER");
  });

  it("returns 400 when code is missing", async () => {
    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1234567890" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CODE");
  });

  it("enforces rate limit per number", async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post("/account/phone/verify")
        .send({ phoneNumber: "+1234567890", code: "123456" });
    }

    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1234567890", code: "123456" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("enforces attempt limit per number", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post("/account/phone/verify")
        .send({ phoneNumber: "+1111111111", code: "000000" });
    }

    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+1111111111", code: "123456" });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("ATTEMPT_LIMIT_EXCEEDED");
  });

  it("returns attemptsRemaining in response", async () => {
    await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+3333333333", code: "000000" });

    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+3333333333", code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.data.attemptsRemaining).toBe(3);
  });

  it("separates rate limits between different numbers", async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post("/account/phone/verify")
        .send({ phoneNumber: "+1111111111", code: "123456" });
    }

    const res = await request(app)
      .post("/account/phone/verify")
      .send({ phoneNumber: "+2222222222", code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.data.phoneNumber).toBe("+2222222222");
  });
});