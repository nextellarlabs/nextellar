import { Request, Response, NextFunction } from 'express';

/**
 * Marker interface for errors that are expected operational failures
 * (DB connection lost, upstream timeouts, validation errors, etc.).
 * Programmer errors (TypeError, ReferenceError, bugs) do NOT set this.
 */
export interface OperationalError extends Error {
  isOperational: true;
  statusCode?: number;
}

export function createOperationalError(message: string, statusCode = 500): OperationalError {
  const err = new Error(message) as OperationalError;
  err.isOperational = true;
  err.statusCode = statusCode;
  return err;
}

export function isOperationalError(err: unknown): err is OperationalError {
  return (
    err instanceof Error &&
    (err as unknown as Record<string, unknown>).isOperational === true
  );
}

/**
 * Alerting hook — swap the default no-op for Sentry / PagerDuty in production.
 * Kept as a replaceable object so tests can mock it without module-level patching.
 */
export interface AlertingService {
  notify(err: Error, context: { url: string; method: string; statusCode: number }): void;
}

export const alertingService: AlertingService = {
  notify: (_err, _context) => {
    // production hook: replace with sentry.captureException / pagerduty.trigger
  },
};

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const anyErr = err as unknown as Record<string, unknown>;
  const statusCode =
    (anyErr.statusCode as number) ||
    (anyErr.status as number) ||
    500;

  if (isOperationalError(err)) {
    // Expected failures: DB timeouts, upstream errors — not bugs
    console.warn('[error:operational]', err.message);
  } else {
    // Unexpected programmer errors: bugs, undefined access, type errors
    console.error('[error:programmer]', err);
    alertingService.notify(err, { url: req.url, method: req.method, statusCode });
  }

  if (process.env.NODE_ENV === 'production') {
    res.status(statusCode).json({
      success: false,
      message: 'Internal Server Error',
    });
  } else {
    res.status(statusCode).json({
      success: false,
      message: err.message,
      stack: err.stack,
    });
  }
}
