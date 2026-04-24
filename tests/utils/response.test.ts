import express, { Request, Response } from "express";
import request from "supertest";

import { sendError } from "../../backend/utils/response.js";

function buildApp(
  handler: (req: Request, res: Response) => void,
): express.Application {
  const app = express();
  app.get("/test", handler);
  return app;
}

describe("sendError", () => {
  it("sets the HTTP status code", async () => {
    const app = buildApp((_req, res) => sendError(res, "SOME_CODE", "msg", 422));
    const res = await request(app).get("/test");
    expect(res.status).toBe(422);
  });

  it("uses 400 as the default status when not provided", async () => {
    const app = buildApp((_req, res) => sendError(res, "CODE", "msg"));
    const res = await request(app).get("/test");
    expect(res.status).toBe(400);
  });

  it("returns the standard error envelope shape", async () => {
    const app = buildApp((_req, res) =>
      sendError(res, "NOT_FOUND", "Resource not found", 404),
    );
    const res = await request(app).get("/test");
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
  });

  it("sets error.code to the provided code string", async () => {
    const app = buildApp((_req, res) =>
      sendError(res, "INVALID_ID", "Invalid id format", 400),
    );
    const res = await request(app).get("/test");
    expect(res.body.error.code).toBe("INVALID_ID");
  });

  it("sets error.message to the provided message string", async () => {
    const app = buildApp((_req, res) =>
      sendError(res, "UPSTREAM_TIMEOUT", "Upstream timed out", 504),
    );
    const res = await request(app).get("/test");
    expect(res.body.error.message).toBe("Upstream timed out");
  });

  it("never includes a top-level 'success' field", async () => {
    const app = buildApp((_req, res) => sendError(res, "CODE", "msg", 400));
    const res = await request(app).get("/test");
    expect(res.body).not.toHaveProperty("success");
  });

  it("never includes a top-level 'message' field", async () => {
    const app = buildApp((_req, res) =>
      sendError(res, "CODE", "inner message", 400),
    );
    const res = await request(app).get("/test");
    expect(res.body).not.toHaveProperty("message");
  });

  it("responds with Content-Type application/json", async () => {
    const app = buildApp((_req, res) => sendError(res, "CODE", "msg", 400));
    const res = await request(app).get("/test");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("works with 5xx status codes", async () => {
    const app = buildApp((_req, res) =>
      sendError(res, "SERVER_ERROR", "Internal error", 500),
    );
    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("SERVER_ERROR");
  });
});
