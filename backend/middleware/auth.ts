import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../auth/token.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Authenticate middleware.
 * Expects a Bearer token in the Authorization header.
 * Verifies the JWT and attaches the payload to req.user.
 */
export function authenticate(
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

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}

/**
 * requireRole middleware factory.
 * Checks if the authenticated user has the required role.
 */
export function requireRole(requiredRole: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: missing user context' });
      return;
    }

    if (req.user.role !== requiredRole) {
      res.status(403).json({ error: 'Forbidden: insufficient role' });
      return;
    }

    next();
  };
}
