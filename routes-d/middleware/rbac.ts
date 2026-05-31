import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { asRole, type Role } from '../auth/roles.js';

/**
 * Shape of the request properties this middleware reads.
 *
 * The token verification layer (impersonation JWT, refresh token, etc.)
 * is expected to populate `req.user.role` before the RBAC middleware
 * runs. We keep this contract narrow so a missing role is treated as
 * "unauthenticated" rather than silently allowed.
 */
interface RbacRequest extends Request {
  user?: { role?: unknown } | undefined;
}

/**
 * Build an Express middleware that gates a route on the caller's role.
 *
 * Behaviour:
 *   - 401 when no authenticated role is present on the request (the JWT
 *     middleware should have already rejected truly unauthenticated
 *     callers; this is a defence-in-depth check).
 *   - 403 when the role is present but not in the allow-list, or when
 *     the claim is malformed (not a string in {@link Role}).
 *   - `next()` when the role matches at least one entry in
 *     `allowedRoles`.
 *
 * `allowedRoles` must be non-empty — gating on an empty allow-list is
 * almost always a bug, so we throw at construction time rather than
 * at request time.
 */
export function requireRole(...allowedRoles: Role[]): RequestHandler {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole called with empty allow-list');
  }

  const allowed = new Set<Role>(allowedRoles);

  return (req: RbacRequest, res: Response, next: NextFunction) => {
    const rawRole = req.user?.role;

    if (rawRole === undefined || rawRole === null) {
      return res.status(401).json({ error: 'authentication required' });
    }

    const role = asRole(rawRole);

    if (!role || !allowed.has(role)) {
      return res.status(403).json({ error: 'insufficient role' });
    }

    return next();
  };
}
