import express from "express";
import request from "supertest";
import { requestId, REQUEST_ID_HEADER } from "../../middleware/requestId.js";
import type { RequestLogger } from "../../middleware/requestId.js";

function buildApp() {
  const app = express();
  app.use(requestId);
  app.get("/ping", (req, res) => {
    res.status(200).json({
      ok: true,
      requestId: res.locals["requestId"],
    });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Unit tests — response header and res.locals
// ---------------------------------------------------------------------------

describe("requestId middleware – response header", () => {
  it("echoes the incoming X-Request-Id header back to the client", async () => {
    const app = buildApp();
    const id = "my-custom-id-123";
    const res = await request(app)
      .get("/ping")
      .set(REQUEST_ID_HEADER, id);

    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(id);
  });

  it("generates a UUID when no X-Request-Id is provided", async () => {
    const app = buildApp();
    const res = await request(app).get("/ping");

    const id = res.headers[REQUEST_ID_HEADER.toLowerCase()] as string;
    expect(id).toBeDefined();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("generates a different ID on every request when no header is supplied", async () => {
    const app = buildApp();
    const [a, b] = await Promise.all([
      request(app).get("/ping"),
      request(app).get("/ping"),
    ]);

    const idA = a.headers[REQUEST_ID_HEADER.toLowerCase()];
    const idB = b.headers[REQUEST_ID_HEADER.toLowerCase()];
    expect(idA).not.toBe(idB);
  });

  it("exposes the request ID in res.locals.requestId", async () => {
    const app = buildApp();
    const id = "locals-check";
    const res = await request(app)
      .get("/ping")
      .set(REQUEST_ID_HEADER, id);

    expect(res.body.requestId).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// Integration — log propagation
// ---------------------------------------------------------------------------

describe("requestId middleware – log propagation", () => {
  it("creates a child logger bound to the request ID when req.log is present", async () => {
    const childSpy = jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    });

    const mockLogger: RequestLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: childSpy,
    };

    const app = express();
    // Attach a fake logger before requestId runs.
    app.use((req, _res, next) => {
      (req as { log?: RequestLogger }).log = mockLogger;
      next();
    });
    app.use(requestId);
    app.get("/ping", (_req, res) => res.json({ ok: true }));

    const id = "log-prop-test";
    await request(app).get("/ping").set(REQUEST_ID_HEADER, id);

    expect(childSpy).toHaveBeenCalledWith({ requestId: id });
  });

  it("does not throw when req.log is absent", async () => {
    const app = buildApp(); // no logger attached
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("requestId middleware – edge cases", () => {
  it("trims whitespace from an incoming X-Request-Id", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set(REQUEST_ID_HEADER, "  trimmed-id  ");

    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe("trimmed-id");
  });

  it("falls back to a generated UUID when X-Request-Id is an empty string", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/ping")
      .set(REQUEST_ID_HEADER, "");

    const id = res.headers[REQUEST_ID_HEADER.toLowerCase()] as string;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
