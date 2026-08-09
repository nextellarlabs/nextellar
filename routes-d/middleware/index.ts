/**
 * routes-d/middleware/index.ts
 *
 * Central middleware registry for the routes-d module.
 *
 * Re-exports:
 *   - requirePartner  – mutual partner authentication
 *   - errorHandler    – structured error envelope
 *   - asyncHandler    – async route wrapper that forwards errors to next()
 *
 * Usage example (in an Express app that mounts routes-d routes):
 *
 *   import { requirePartner, errorHandler } from './routes-d/middleware/index.js';
 *
 *   app.use(express.json());
 *   app.use(travelRuleRouter);          // routes already have requirePartner inline
 *   app.use(errorHandler);              // catch-all error handler
 */

export { requirePartner } from '../auth/mutualAuth.js';
export type { PartnerRequest } from '../auth/mutualAuth.js';

export { errorHandler, asyncHandler } from './errorHandler.js';
export type { ApiError } from './errorHandler.js';
