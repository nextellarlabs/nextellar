import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REQUEST_ID_HEADER = "x-request-id";

export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Attaches a correlation ID to every request for distributed tracing.
 *
 * - Generates a fresh UUID v4 when X-Request-ID is absent.
 * - Validates the UUID format when the header is present; rejects with 400 on invalid values.
 * - Exposes the ID via res.locals.requestId and echoes it in the X-Request-ID response header.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers[REQUEST_ID_HEADER] as string | undefined;

  let id: string;

  if (inbound === undefined || inbound === "") {
    id = randomUUID();
  } else if (!isValidUUID(inbound)) {
    sendError(res, "INVALID_REQUEST_ID", "X-Request-ID must be a valid UUID", 400);
    return;
  } else {
    id = inbound;
  }

  res.locals["requestId"] = id;
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
}

export function getRequestId(res: Response): string | undefined {
  return res.locals["requestId"] as string | undefined;
}