import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountEmailChangeRouter, {
  __getUsers,
  __seedUser,
  __getEmailChangeRequests,
  __resetEmailChange,
} from "../routes/account.email.change.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountEmailChangeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /account/email/change", () => {
  const app = buildApp();

  const USER_ID = "user-abc123";
  const validRequest = {
    newEmail: "newemail@example.com",
  };

  beforeEach(() => {
    __resetEmailChange();
    __seedUser({
      id: USER_ID,
      email: "oldemail@example.com",
    });
  });

  it("creates an email change request with valid data", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.newEmail).toBe(validRequest.newEmail);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.expiresAt).toBeDefined();
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).post("/account/email/change").send(validRequest);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when newEmail is missing", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EMAIL");
  });

  it("returns 400 when newEmail is invalid", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send({ newEmail: "invalid-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EMAIL");
  });

  it("returns 400 when newEmail is the same as current email", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send({ newEmail: "oldemail@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SAME_EMAIL");
  });

  it("returns 404 when user is not found", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", "nonexistent-user")
      .send(validRequest);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("returns 409 when a pending change request already exists", async () => {
    const res1 = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send({ newEmail: "another@example.com" });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe("PENDING_CHANGE_EXISTS");
  });

  it("maintains email change request correctly", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);

    const requests = __getEmailChangeRequests();
    expect(requests.size).toBe(1);

    const requestEntry = Array.from(requests.values())[0];
    expect(requestEntry.userId).toBe(USER_ID);
    expect(requestEntry.oldEmail).toBe("oldemail@example.com");
    expect(requestEntry.newEmail).toBe(validRequest.newEmail);
    expect(requestEntry.verified).toBe(false);
  });

  it("keeps old email active until verification", async () => {
    const res = await request(app)
      .post("/account/email/change")
      .set("x-user-id", USER_ID)
      .send(validRequest);

    expect(res.status).toBe(201);

    const users = __getUsers();
    const user = users.get(USER_ID);
    expect(user!.email).toBe("oldemail@example.com");
  });
});
