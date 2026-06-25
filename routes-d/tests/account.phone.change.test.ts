import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountPhoneChangeRouter, {
  __getUsers,
  __seedUser,
  __getPhoneChangeRequests,
  __resetPhoneChange,
} from "../routes/account.phone.change.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountPhoneChangeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /account/phone/change", () => {
  const app = buildApp();

  const USER_ID = "user-abc123";
  const validRequest = {
    newPhone: "+1234567890",
    otp: "123456",
  };

  beforeEach(() => {
    __resetPhoneChange();
    __seedUser({
      id: USER_ID,
      phone: "+0987654321",
      lastAuthenticatedAt: new Date().toISOString(),
    });
  });

  it("changes phone number with valid data and OTP", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.oldPhone).toBe("+0987654321");
    expect(res.body.data.newPhone).toBe(validRequest.newPhone);
    expect(res.body.data.changedAt).toBeDefined();
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).post("/account/phone/change").send(validRequest);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when newPhone is missing", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ otp: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PHONE");
  });

  it("returns 400 when newPhone is invalid", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ newPhone: "invalid-phone", otp: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PHONE");
  });

  it("returns 400 when OTP is missing", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ newPhone: "+1234567890" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("returns 400 when OTP is not 6 digits", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ newPhone: "+1234567890", otp: "123" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_OTP");
  });

  it("returns 403 when fresh authentication is required (no auth timestamp)", async () => {
    __resetPhoneChange();
    __seedUser({
      id: USER_ID,
      phone: "+0987654321",
    });

    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 403 when fresh authentication is required (auth too old)", async () => {
    __resetPhoneChange();
    const oldAuth = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    __seedUser({
      id: USER_ID,
      phone: "+0987654321",
      lastAuthenticatedAt: oldAuth,
    });

    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 400 when newPhone is the same as current phone", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ newPhone: "+0987654321", otp: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SAME_PHONE");
  });

  it("returns 409 when a pending change request already exists", async () => {
    const res1 = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send({ newPhone: "+1987654321", otp: "654321" });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("PENDING_CHANGE_EXISTS");
  });

  it("maintains phone change request correctly", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(200);

    const requests = __getPhoneChangeRequests();
    expect(requests.has(USER_ID)).toBe(true);

    const requestEntry = requests.get(USER_ID);
    expect(requestEntry!.userId).toBe(USER_ID);
    expect(requestEntry!.oldPhone).toBe("+0987654321");
    expect(requestEntry!.newPhone).toBe(validRequest.newPhone);
    expect(requestEntry!.verified).toBe(true);
  });

  it("applies the phone change immediately after OTP verification", async () => {
    const res = await request(app)
      .post("/account/phone/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(200);

    const users = __getUsers();
    const user = users.get(USER_ID);
    expect(user!.phone).toBe(validRequest.newPhone);
  });
});
