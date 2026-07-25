/**
 * Unit tests for sarRules.ts
 */

import {
  evaluateRule,
  evaluateActivities,
  generateSuspiciousActivityReport,
  getDefaultSarRulesConfig,
  getSarRulesConfig,
  loadSarRulesConfig,
  reloadSarRulesConfig,
  __resetSarRulesConfig,
  __resetSarReportSequence,
  type ActivityRecord,
  type SarRuleDefinition,
  SarRulesConfigError,
} from '../../lib/sarRules.js';

describe('sarRules', () => {
  beforeEach(() => {
    __resetSarRulesConfig();
    __resetSarReportSequence();
  });

  const baseActivity: ActivityRecord = {
    id: 'act-1',
    timestamp: '2026-07-25T10:00:00.000Z',
    type: 'payment_send',
    amount: 12_000,
    asset: 'USDC',
  };

  describe('rule match', () => {
    it('returns a hit when amount exceeds the large transfer threshold', () => {
      const config = getSarRulesConfig();
      const rule = config.rules.find((r) => r.id === 'large-single-transfer');
      expect(rule).toBeDefined();

      const hit = evaluateRule(rule as SarRuleDefinition, baseActivity);
      expect(hit).not.toBeNull();
      expect(hit?.ruleId).toBe('large-single-transfer');
      expect(hit?.matchedValue).toBe(12_000);
      expect(hit?.activityId).toBe('act-1');
    });

    it('generates a suspicious report with annotated hits', () => {
      const report = generateSuspiciousActivityReport('user-42', [baseActivity]);
      expect(report.suspicious).toBe(true);
      expect(report.hitCount).toBeGreaterThan(0);
      expect(report.configVersion).toBe('1.0.0');
      expect(report.hits[0]).toMatchObject({
        ruleId: expect.any(String),
        message: expect.any(String),
        matchedValue: 12_000,
      });
    });
  });

  describe('rule miss', () => {
    it('returns no hits for benign activity amounts', () => {
      const benign: ActivityRecord = {
        ...baseActivity,
        id: 'act-2',
        amount: 50,
        type: 'payment_receive',
      };

      const hits = evaluateActivities([benign]);
      expect(hits).toHaveLength(0);
    });

    it('generates a non-suspicious report when no rules match', () => {
      const benign: ActivityRecord = {
        ...baseActivity,
        id: 'act-3',
        amount: 25,
        type: 'payment_receive',
      };

      const report = generateSuspiciousActivityReport('user-99', [benign]);
      expect(report.suspicious).toBe(false);
      expect(report.hitCount).toBe(0);
      expect(report.hits).toEqual([]);
    });
  });

  describe('configuration reload', () => {
    it('uses reloaded thresholds for subsequent evaluations', () => {
      const before = evaluateActivities([{ ...baseActivity, amount: 800 }]);
      expect(before).toHaveLength(0);

      reloadSarRulesConfig({
        version: '1.1.0',
        rules: [
          {
            id: 'custom-low-threshold',
            name: 'Custom low threshold',
            description: 'Test rule',
            field: 'amount',
            operator: 'gte',
            threshold: 500,
            severity: 'medium',
            enabled: true,
          },
        ],
      });

      expect(getSarRulesConfig().version).toBe('1.1.0');

      const after = evaluateActivities([{ ...baseActivity, amount: 800 }]);
      expect(after).toHaveLength(1);
      expect(after[0].ruleId).toBe('custom-low-threshold');
    });

    it('rejects invalid config on load', () => {
      expect(() =>
        loadSarRulesConfig({
          version: '',
          rules: [],
        }),
      ).toThrow(SarRulesConfigError);
    });

    it('restores default config shape after reset helper', () => {
      reloadSarRulesConfig({
        version: '9.9.9',
        rules: getDefaultSarRulesConfig().rules,
      });
      __resetSarRulesConfig();
      expect(getSarRulesConfig().version).toBe('1.0.0');
    });
  });
});
