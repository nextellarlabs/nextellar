import express, { Request, Response } from "express";
import request from "supertest";

import { requestId, getRequestId, isValidUUID, REQUEST_ID_HEADER } from "../../backend/middleware/requestId.js";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildApp() {
  const app = express();
  app.use(requestId);
  app.get("/ping", (_req: Request, res: Response) => {
    res.status(200).json({
      requestId: getRequestId(res),
      localsId: res.locals["requestId"],
    });
  });
  return app;
}

describe("requestId middleware", () => {
  const app = buildApp();

  describe("auto-generated request ID", () => {
    it("generates a UUID when X-Request-ID header is absent", async () => {
      const res = await request(app).get("/ping");

      expect(res.status).toBe(200);
      expect(res.body.requestId).toMatch(UUID_REGEX);
    });

    it("generated ID is present in the response header", async () => {
      const res = await request(app).get("/ping");

      expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_REGEX);
    });

    it("response header ID matches the ID in res.locals", async () => {
      const res = await request(app).get("/ping");

      expect(res.headers[REQUEST_ID_HEADER]).toBe(res.body.requestId);
      expect(res.body.localsId).toBe(res.body.requestId);
    });

    it("each request gets a unique generated ID", async () => {
      const res1 = await request(app).get("/ping");
      const res2 = await request(app).get("/ping");

      expect(res1.headers[REQUEST_ID_HEADER]).not.toBe(res2.headers[REQUEST_ID_HEADER]);
    });
  });

  describe("valid inbound X-Request-ID", () => {
    it("passes through a valid UUID from the request header", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, VALID_UUID);

      expect(res.status).toBe(200);
      expect(res.headers[REQUEST_ID_HEADER]).toBe(VALID_UUID);
      expect(res.body.requestId).toBe(VALID_UUID);
    });

    it("valid UUID is propagated to res.locals", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, VALID_UUID);

      expect(res.body.localsId).toBe(VALID_UUID);
    });

    it("same ID persists from request through to response header", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, VALID_UUID);

      expect(res.headers[REQUEST_ID_HEADER]).toBe(VALID_UUID);
      expect(res.body.requestId).toBe(VALID_UUID);
    });
  });

  describe("invalid inbound X-Request-ID", () => {
    it("rejects a plain string with 400", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, "not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST_ID");
    });

    it("rejects a numeric string with 400", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, "12345");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST_ID");
    });

    it("rejects a UUID with wrong structure", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST_ID");
    });

    it("error response uses standard error envelope shape", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, "bad-id");

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("INVALID_REQUEST_ID");
      expect(res.body.error.message).toBeDefined();
    });

    it("does not set X-Request-ID response header on rejection", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, "bad-id");

      expect(res.status).toBe(400);
      // Response ID header should not be the invalid value
      expect(res.headers[REQUEST_ID_HEADER]).toBeUndefined();
    });
  });

  describe("logger context integration", () => {
    it("getRequestId returns the same ID stored in res.locals", async () => {
      const res = await request(app).get("/ping").set(REQUEST_ID_HEADER, VALID_UUID);

      // Route handler calls getRequestId(res) and includes it in body
      expect(res.body.requestId).toBe(VALID_UUID);
    });

    it("getRequestId returns undefined when middleware was not applied", () => {
      const fakeRes = { locals: {} } as Response;
      expect(getRequestId(fakeRes)).toBeUndefined();
    });
  });

  describe("isValidUUID helper", () => {
    it("accepts standard v4 UUID", () => {
      expect(isValidUUID(VALID_UUID)).toBe(true);
    });

    it("accepts uppercase UUID", () => {
      expect(isValidUUID(VALID_UUID.toUpperCase())).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isValidUUID("")).toBe(false);
    });

    it("rejects non-UUID string", () => {
      expect(isValidUUID("not-a-uuid")).toBe(false);
    });

    it("rejects UUID with wrong segment length", () => {
      expect(isValidUUID("123e4567-e89b-12d3-a456-4266141740")).toBe(false);
    });
  });
});
