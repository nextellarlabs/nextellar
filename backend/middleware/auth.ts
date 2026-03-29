import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Auth guard middleware.
 * Expects a Bearer token in the Authorization header.
 * In production this would verify a real JWT; here we validate
 * that a non-empty token is present so the shape is correct.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    return;
  }

  const token = authHeader.slice(7);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: empty token' });
    return;
  }

  // Attach the decoded user id to the request for downstream handlers.
  // A real implementation would call jwt.verify() here.
  req.userId = token;
  next();
}
