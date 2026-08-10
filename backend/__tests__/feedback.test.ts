import request from "supertest";
import app from "../app.js";
import { MAX_MESSAGE_LENGTH, MAX_SUBJECT_LENGTH } from "../routes/feedback.js";

function subjectAtLimit(): string {
  return "a".repeat(MAX_SUBJECT_LENGTH);
}

function messageAtLimit(): string {
  return "b".repeat(MAX_MESSAGE_LENGTH);
}

describe("POST /feedback", () => {
  it("accepts subject and message at the maximum length", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: subjectAtLimit(), message: messageAtLimit() });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
  });

  it("rejects subject over the maximum with 400 and the limit in the message", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "a".repeat(MAX_SUBJECT_LENGTH + 1), message: "ok" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      `subject exceeds maximum length of ${MAX_SUBJECT_LENGTH} characters`,
    );
  });

  it("rejects message over the maximum with 400 and the limit in the message", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "ok", message: "b".repeat(MAX_MESSAGE_LENGTH + 1) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
    );
  });

  it("rejects an empty subject", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "", message: "not empty" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "subject is required" });
  });

  it("rejects a whitespace-only subject", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "   \t  ", message: "not empty" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "subject is required" });
  });

  it("rejects an empty message", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "not empty", message: "" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "message is required" });
  });

  it("rejects a whitespace-only message", async () => {
    const res = await request(app)
      .post("/feedback")
      .send({ subject: "not empty", message: " \n  " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "message is required" });
  });
});
