/**
 * Error Rate Alerting Hooks
 * Integrates with the existing alerting system for backup verification failures.
 */

export interface AlertPayload {
  service: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export type AlertHandler = (payload: AlertPayload) => Promise<void> | void;

// In-memory store for testing; in production, this would integrate with external systems
const alertHistory: AlertPayload[] = [];
const handlers: AlertHandler[] = [];

/**
 * Register an alert handler
 */
export function registerAlertHandler(handler: AlertHandler): void {
  handlers.push(handler);
}

/**
 * Remove an alert handler
 */
export function unregisterAlertHandler(handler: AlertHandler): void {
  const idx = handlers.indexOf(handler);
  if (idx !== -1) {
    handlers.splice(idx, 1);
  }
}

/**
 * Clear all handlers (useful for testing)
 */
export function clearAlertHandlers(): void {
  handlers.length = 0;
}

/**
 * Get alert history (for verification/testing)
 */
export function getAlertHistory(): readonly AlertPayload[] {
  return [...alertHistory];
}

/**
 * Clear alert history
 */
export function clearAlertHistory(): void {
  alertHistory.length = 0;
}

/**
 * Send alert through all registered handlers
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  alertHistory.push(payload);

  const results = handlers.map(async (handler) => {
    try {
      await handler(payload);
    } catch (err) {
      // Log but don't throw to prevent cascading failures
      console.error('Alert handler failed:', err);
    }
  });

  await Promise.all(results);
}

/**
 * Convenience function for backup verification alerts
 */
export async function sendBackupAlert(
  success: boolean,
  message: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await sendAlert({
    service: 'routes-d-backup-verify',
    severity: success ? 'info' : 'error',
    message,
    metadata,
    timestamp: new Date(),
  });
}

// Default console handler for development
registerAlertHandler(async (payload) => {
  const prefix = `[${payload.severity.toUpperCase()}] ${payload.service}`;
  console.error(`${prefix}: ${payload.message}`);
});