/**
 * Suspicious Activity Report (SAR) detection rules and report generation.
 */

export type SarRuleOperator = 'gt' | 'gte' | 'eq' | 'lt' | 'lte';

export type SarRuleDefinition = {
  id: string;
  name: string;
  description: string;
  field: string;
  operator: SarRuleOperator;
  threshold: number;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
};

export type SarRulesConfig = {
  version: string;
  rules: SarRuleDefinition[];
};

export type ActivityRecord = {
  id: string;
  timestamp: string;
  type: string;
  amount?: number;
  asset?: string;
  counterparty?: string;
  metadata?: Record<string, unknown>;
};

export type RuleHit = {
  ruleId: string;
  ruleName: string;
  severity: SarRuleDefinition['severity'];
  activityId: string;
  field: string;
  matchedValue: number;
  threshold: number;
  operator: SarRuleOperator;
  message: string;
};

export type SuspiciousActivityReport = {
  reportId: string;
  generatedAt: string;
  configVersion: string;
  subjectId: string;
  suspicious: boolean;
  hitCount: number;
  hits: RuleHit[];
  activitiesReviewed: number;
};

export class SarRulesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SarRulesConfigError';
  }
}

const DEFAULT_SAR_RULES_CONFIG: SarRulesConfig = {
  version: '1.0.0',
  rules: [
    {
      id: 'large-single-transfer',
      name: 'Large single transfer',
      description: 'Flag transfers above the configured USD-equivalent amount threshold',
      field: 'amount',
      operator: 'gt',
      threshold: 10_000,
      severity: 'high',
      enabled: true,
    },
    {
      id: 'elevated-transfer',
      name: 'Elevated transfer',
      description: 'Flag transfers above the medium-risk amount threshold',
      field: 'amount',
      operator: 'gte',
      threshold: 5_000,
      severity: 'medium',
      enabled: true,
    },
    {
      id: 'rapid-outbound',
      name: 'Rapid outbound activity',
      description: 'Flag high-frequency outbound payment types',
      field: 'amount',
      operator: 'gt',
      threshold: 1_000,
      severity: 'low',
      enabled: true,
    },
  ],
};

let activeConfig: SarRulesConfig = cloneConfig(DEFAULT_SAR_RULES_CONFIG);

function cloneConfig(config: SarRulesConfig): SarRulesConfig {
  return {
    version: config.version,
    rules: config.rules.map((rule) => ({ ...rule })),
  };
}

function validateRulesConfig(config: SarRulesConfig): void {
  if (!config || typeof config !== 'object') {
    throw new SarRulesConfigError('Config must be an object');
  }
  if (!config.version || typeof config.version !== 'string' || !config.version.trim()) {
    throw new SarRulesConfigError('Config version is required');
  }
  if (!Array.isArray(config.rules)) {
    throw new SarRulesConfigError('Config rules must be an array');
  }

  const seenIds = new Set<string>();
  for (const rule of config.rules) {
    if (!rule.id || typeof rule.id !== 'string') {
      throw new SarRulesConfigError('Each rule must have a string id');
    }
    if (seenIds.has(rule.id)) {
      throw new SarRulesConfigError(`Duplicate rule id: ${rule.id}`);
    }
    seenIds.add(rule.id);

    if (!rule.field || typeof rule.field !== 'string') {
      throw new SarRulesConfigError(`Rule ${rule.id} must specify a field`);
    }
    if (!['gt', 'gte', 'eq', 'lt', 'lte'].includes(rule.operator)) {
      throw new SarRulesConfigError(`Rule ${rule.id} has invalid operator`);
    }
    if (typeof rule.threshold !== 'number' || Number.isNaN(rule.threshold)) {
      throw new SarRulesConfigError(`Rule ${rule.id} must have a numeric threshold`);
    }
    if (!['low', 'medium', 'high'].includes(rule.severity)) {
      throw new SarRulesConfigError(`Rule ${rule.id} has invalid severity`);
    }
    if (typeof rule.enabled !== 'boolean') {
      throw new SarRulesConfigError(`Rule ${rule.id} must declare enabled as boolean`);
    }
  }
}

export function getDefaultSarRulesConfig(): SarRulesConfig {
  return cloneConfig(DEFAULT_SAR_RULES_CONFIG);
}

export function getSarRulesConfig(): SarRulesConfig {
  return cloneConfig(activeConfig);
}

export function loadSarRulesConfig(config: SarRulesConfig): SarRulesConfig {
  validateRulesConfig(config);
  activeConfig = cloneConfig(config);
  return getSarRulesConfig();
}

export function reloadSarRulesConfig(config: SarRulesConfig): SarRulesConfig {
  return loadSarRulesConfig(config);
}

export function __resetSarRulesConfig(): void {
  activeConfig = cloneConfig(DEFAULT_SAR_RULES_CONFIG);
}

function readNumericField(activity: ActivityRecord, field: string): number | null {
  const record = activity as Record<string, unknown>;
  const value = record[field];
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  return null;
}

function compareNumeric(
  operator: SarRuleOperator,
  value: number,
  threshold: number,
): boolean {
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'eq':
      return value === threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    default:
      return false;
  }
}

function ruleAppliesToActivity(rule: SarRuleDefinition, activity: ActivityRecord): boolean {
  if (rule.id === 'rapid-outbound') {
    return activity.type === 'payment_send';
  }
  return true;
}

export function evaluateRule(
  rule: SarRuleDefinition,
  activity: ActivityRecord,
): RuleHit | null {
  if (!rule.enabled) {
    return null;
  }
  if (!ruleAppliesToActivity(rule, activity)) {
    return null;
  }

  const value = readNumericField(activity, rule.field);
  if (value === null) {
    return null;
  }

  if (!compareNumeric(rule.operator, value, rule.threshold)) {
    return null;
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    activityId: activity.id,
    field: rule.field,
    matchedValue: value,
    threshold: rule.threshold,
    operator: rule.operator,
    message: `${rule.name}: ${rule.field} ${rule.operator} ${rule.threshold} (actual ${value})`,
  };
}

export function evaluateActivities(
  activities: ActivityRecord[],
  config: SarRulesConfig = activeConfig,
): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const activity of activities) {
    for (const rule of config.rules) {
      const hit = evaluateRule(rule, activity);
      if (hit) {
        hits.push(hit);
      }
    }
  }
  return hits;
}

let reportSequence = 0;

export function __resetSarReportSequence(): void {
  reportSequence = 0;
}

function nextReportId(): string {
  reportSequence += 1;
  return `sar-${Date.now()}-${reportSequence}`;
}

export function generateSuspiciousActivityReport(
  subjectId: string,
  activities: ActivityRecord[],
  config: SarRulesConfig = activeConfig,
): SuspiciousActivityReport {
  const hits = evaluateActivities(activities, config);
  return {
    reportId: nextReportId(),
    generatedAt: new Date().toISOString(),
    configVersion: config.version,
    subjectId,
    suspicious: hits.length > 0,
    hitCount: hits.length,
    hits,
    activitiesReviewed: activities.length,
  };
}
