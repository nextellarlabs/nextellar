import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import {
  globalErrorHandler,
  alertingService,
  createOperationalError,
  isOperationalError,
} from "../../backend/middleware/errorHandler.js";

function buildApp(errFactory: () => Error) {
  const app = express();
  app.get("/__error_test", (_req: Request, _res: Response, next: NextFunction) => {
    next(errFactory());
  });
  app.use(globalErrorHandler);
  return app;
}

describe("Global Error Handler", () => {
  const OriginalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = OriginalNodeEnv;
  });

  // ─── existing contract tests ───────────────────────────────────────────────

  it("should leak stack trace when NODE_ENV is development", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp(() => new Error("Test Error"));
    const res = await request(app).get("/__error_test");

    expect(consoleSpy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Test Error");
    expect(res.body.stack).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("should hide stack trace and return generic message when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp(() => new Error("Test Error"));
    const res = await request(app).get("/__error_test");

    expect(consoleSpy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Internal Server Error");
    expect(res.body.stack).toBeUndefined();

    consoleSpy.mockRestore();
  });

  // ─── error classification ──────────────────────────────────────────────────

  it("logs programmer errors at console.error level", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const app = buildApp(() => new Error("unexpected bug"));

    await request(app).get("/__error_test");

    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs operational errors at console.warn level", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const app = buildApp(() => createOperationalError("DB connection lost", 503));

    await request(app).get("/__error_test");

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ─── alerting hook ─────────────────────────────────────────────────────────

  it("calls the alert hook for programmer (5xx) errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const notifySpy = jest.spyOn(alertingService, "notify");
    const app = buildApp(() => new Error("runtime crash"));

    const res = await request(app).get("/__error_test");

    expect(res.status).toBe(500);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ statusCode: 500 }),
    );

    notifySpy.mockRestore();
    jest.spyOn(console, "error").mockRestore();
  });

  it("does NOT call the alert hook for operational errors", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const notifySpy = jest.spyOn(alertingService, "notify");
    const app = buildApp(() => createOperationalError("service unavailable", 503));

    await request(app).get("/__error_test");

    expect(notifySpy).not.toHaveBeenCalled();

    notifySpy.mockRestore();
    jest.spyOn(console, "warn").mockRestore();
  });

  // ─── isOperationalError helper ─────────────────────────────────────────────

  it("isOperationalError returns true for operational errors", () => {
    const err = createOperationalError("db timeout");
    expect(isOperationalError(err)).toBe(true);
  });

  it("isOperationalError returns false for plain errors", () => {
    expect(isOperationalError(new Error("bug"))).toBe(false);
    expect(isOperationalError(new TypeError("type issue"))).toBe(false);
    expect(isOperationalError(null)).toBe(false);
    expect(isOperationalError("string error")).toBe(false);
  });

  // ─── client safety ─────────────────────────────────────────────────────────

  it("never leaks internal stack in production for any error type", async () => {
    process.env.NODE_ENV = "production";
    jest.spyOn(console, "error").mockImplementation(() => {});
    const app = buildApp(() => new Error("secret internal detail"));

    const res = await request(app).get("/__error_test");

    expect(res.body.stack).toBeUndefined();
    expect(res.text).not.toContain("secret internal detail");

    jest.spyOn(console, "error").mockRestore();
  });
});
