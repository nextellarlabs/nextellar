import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'validation_error');
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'authentication_error');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'authorization_error');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'conflict');
    this.name = 'ConflictError';
  }
}

interface ErrorResponse {
  error: string;
  code?: string;
  requestId?: string;
}

export type InternalLogger = (details: Record<string, unknown>) => void;

export interface ErrorHandlerOptions {
  logger?: InternalLogger;
  /** Include `requestId` from `res.locals.requestId` in the error response. */
  includeRequestId?: boolean;
}

const DEFAULT_LOGGER: InternalLogger = (details) => {
  console.error(JSON.stringify({ level: 'error', ...details }));
};

function redact(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    const body: ErrorResponse = { error: err.message };
    if (err.code) body.code = err.code;
    return body;
  }
  return { error: 'Internal server error' };
}

function statusFor(err: unknown): number {
  if (err instanceof AppError) return err.statusCode;

  // Accept 4xx status codes carried by body-parser and similar framework errors.
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    const s = (err as { status: number }).status;
    if (s >= 400 && s < 500) return s;
  }

  return 500;
}

export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const includeRequestId = options.includeRequestId ?? true;

  // Four-parameter signature is required by Express to recognise this as an
  // error-handling middleware, even though _next is never called here.
  return function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const status = statusFor(err);
    const requestId: string | undefined =
      includeRequestId && typeof res.locals['requestId'] === 'string'
        ? (res.locals['requestId'] as string)
        : undefined;

    // Log full details internally — never forward stack traces or internal
    // messages to the client.
    logger({
      requestId,
      method: req.method,
      path: req.path,
      status,
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });

    const body: ErrorResponse = redact(err);
    if (requestId) body.requestId = requestId;

    res.status(status).json(body);
  };
}

export const errorHandler: ErrorRequestHandler = createErrorHandler();
