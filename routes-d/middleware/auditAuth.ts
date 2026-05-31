/**
 * Middleware/wrapper that automatically logs failed auth attempts.
 * Use around any auth handler in routes-d.
 */

import { recordFailedAuth } from "../lib/auditLog.js";

interface AuthAttemptParams {
  ip: string;
  identifier: string;
  identifierType: "email" | "pubkey" | "wallet";
  route: string;
  userAgent?: string;
}

/**
 * Wrap an auth handler to automatically audit log failures.
 */
export function withAuditLogging<T extends (...args: any[]) => Promise<Response>>(
  handler: T,
  getAttemptParams: (...args: Parameters<T>) => AuthAttemptParams
): T {
  return (async (...args: Parameters<T>) => {
    try {
      const response = await handler(...args);
      
      // Log failed auth (4xx responses)
      if (response.status >= 400 && response.status < 500) {
        const params = getAttemptParams(...args);
        const body = await response.clone().text();
        let reason = `HTTP ${response.status}`;
        
        try {
          const json = JSON.parse(body);
          reason = json.error || json.message || reason;
        } catch {
          // not JSON, use status
        }

        recordFailedAuth({
          ...params,
          reason,
        });
      }
      
      return response;
    } catch (error) {
      // Log thrown errors too
      const params = getAttemptParams(...args);
      recordFailedAuth({
        ...params,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }) as T;
}

/**
 * Standalone helper to log a failed attempt from any context.
 */
export function logFailedAuth(params: AuthAttemptParams & { reason: string }): void {
  recordFailedAuth(params);
}