/**
 * Unit tests for alertHooks.ts
 */

import {
  sendAlert,
  sendBackupAlert,
  registerAlertHandler,
  unregisterAlertHandler,
  clearAlertHandlers,
  clearAlertHistory,
  getAlertHistory,
  type AlertPayload,
} from '../../lib/alertHooks.js';

describe('alertHooks', () => {
  let capturedAlerts: AlertPayload[] = [];

  const testHandler = async (payload: AlertPayload): Promise<void> => {
    capturedAlerts.push(payload);
  };

  beforeEach(() => {
    capturedAlerts = [];
    clearAlertHandlers();
    clearAlertHistory();
    registerAlertHandler(testHandler);
  });

  afterEach(() => {
    clearAlertHandlers();
    clearAlertHistory();
  });

  describe('sendAlert', () => {
    it('delivers alert to all registered handlers', async () => {
      const payload: AlertPayload = {
        service: 'test-service',
        severity: 'error',
        message: 'Test error',
        metadata: { key: 'value' },
        timestamp: new Date(),
      };

      await sendAlert(payload);

      expect(capturedAlerts).toHaveLength(1);
      expect(capturedAlerts[0].message).toBe('Test error');
      expect(capturedAlerts[0].severity).toBe('error');
    });

    it('stores alerts in history', async () => {
      await sendAlert({
        service: 'test',
        severity: 'info',
        message: 'First',
        metadata: {},
        timestamp: new Date(),
      });

      await sendAlert({
        service: 'test',
        severity: 'warning',
        message: 'Second',
        metadata: {},
        timestamp: new Date(),
      });

      const history = getAlertHistory();
      expect(history).toHaveLength(2);
      expect(history[0].message).toBe('First');
      expect(history[1].message).toBe('Second');
    });

    it('continues even if a handler throws', async () => {
      const failingHandler = async (): Promise<void> => {
        throw new Error('Handler failed');
      };

      registerAlertHandler(failingHandler);

      await expect(
        sendAlert({
          service: 'test',
          severity: 'error',
          message: 'Should not throw',
          metadata: {},
          timestamp: new Date(),
        })
      ).resolves.not.toThrow();

      // The test handler should still receive it
      expect(capturedAlerts).toHaveLength(1);
    });
  });

  describe('sendBackupAlert', () => {
    it('sends info alert on success', async () => {
      await sendBackupAlert(true, 'Backup verified successfully', { backupId: '123' });

      expect(capturedAlerts).toHaveLength(1);
      expect(capturedAlerts[0].severity).toBe('info');
      expect(capturedAlerts[0].service).toBe('routes-d-backup-verify');
      expect(capturedAlerts[0].metadata.backupId).toBe('123');
    });

    it('sends error alert on failure', async () => {
      await sendBackupAlert(false, 'Backup verification failed', { error: 'corrupt' });

      expect(capturedAlerts).toHaveLength(1);
      expect(capturedAlerts[0].severity).toBe('error');
      expect(capturedAlerts[0].message).toContain('failed');
    });
  });

  describe('handler management', () => {
    it('can unregister handlers', async () => {
      unregisterAlertHandler(testHandler);

      await sendAlert({
        service: 'test',
        severity: 'error',
        message: 'Should not capture',
        metadata: {},
        timestamp: new Date(),
      });

      expect(capturedAlerts).toHaveLength(0);
    });

    it('clearAlertHandlers removes all handlers', async () => {
      clearAlertHandlers();

      await sendAlert({
        service: 'test',
        severity: 'error',
        message: 'Should not capture',
        metadata: {},
        timestamp: new Date(),
      });

      expect(capturedAlerts).toHaveLength(0);
    });
  });
});