import { Response } from 'express';

/**
 * Standard error envelope used by every route in this application.
 *
 * { "error": { "code": "VALIDATION_ERROR", "message": "Readable message" } }
 */
export function sendError(
  res: Response,
  code: string,
  message: string,
  status = 400,
): void {
  res.status(status).json({ error: { code, message } });
}
