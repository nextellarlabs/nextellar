// Unit and integration tests for routes-d/lib/logger.ts (Issue #326).

import { Logger, redactContext, type LogEntry, type LogLevel } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureLogs(level?: LogLevel): { entries: LogEntry[]; logger: Logger } {
  const entries: LogEntry[] = [];
  const log = new Logger({ level, sink: (e) => entries.push(e) });
  return { entries, logger: log };
}

// ---------------------------------------------------------------------------
// JSON output format
// ---------------------------------------------------------------------------

describe('Logger — JSON output', () => {
  it('emits level, msg, and ts fields', () => {
    const { entries, logger } = captureLogs('info');
    logger.info('hello world');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.msg).toBe('hello world');
    expect(typeof entries[0]?.ts).toBe('string');
    expect(new Date(entries[0]!.ts).toISOString()).toBe(entries[0]!.ts);
  });

  it('merges extra fields into the log entry', () => {
    const { entries, logger } = captureLogs('info');
    logger.info('request', { route: '/pay', method: 'POST' });
    expect(entries[0]?.route).toBe('/pay');
    expect(entries[0]?.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Level filtering
// ---------------------------------------------------------------------------

describe('Logger — level filtering', () => {
  it('suppresses debug when min level is info', () => {
    const { entries, logger } = captureLogs('info');
    logger.debug('verbose detail');
    expect(entries).toHaveLength(0);
  });

  it('suppresses debug and info when min level is warn', () => {
    const { entries, logger } = captureLogs('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('emits all levels when min level is debug', () => {
    const { entries, logger } = captureLogs('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries).toHaveLength(4);
  });

  it('only emits error when min level is error', () => {
    const { entries, logger } = captureLogs('error');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('only this');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Redaction — direct fields
// ---------------------------------------------------------------------------

describe('redactContext — direct secret fields', () => {
  it('redacts password', () => {
    const out = redactContext({ password: 'hunter2' });
    expect(out['password']).toBe('[REDACTED]');
  });

  it('redacts token', () => {
    const out = redactContext({ token: 'eyJ...' });
    expect(out['token']).toBe('[REDACTED]');
  });

  it('redacts email', () => {
    const out = redactContext({ email: 'user@example.com' });
    expect(out['email']).toBe('[REDACTED]');
  });

  it('redacts apiKey', () => {
    const out = redactContext({ apiKey: 'sk-123' });
    expect(out['apiKey']).toBe('[REDACTED]');
  });

  it('redacts authorization', () => {
    const out = redactContext({ authorization: 'Bearer xyz' });
    expect(out['authorization']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive fields', () => {
    const out = redactContext({ route: '/api', status: 200 });
    expect(out['route']).toBe('/api');
    expect(out['status']).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Redaction — nested objects
// ---------------------------------------------------------------------------

describe('redactContext — nested objects', () => {
  it('redacts deeply nested secrets', () => {
    const out = redactContext({
      user: { profile: { password: 's3cret', name: 'Alice' } },
    }) as { user: { profile: { password: string; name: string } } };
    expect(out.user.profile.password).toBe('[REDACTED]');
    expect(out.user.profile.name).toBe('Alice');
  });

  it('redacts secrets inside arrays', () => {
    const out = redactContext({
      items: [{ token: 'abc' }, { label: 'safe' }],
    }) as { items: Array<Record<string, unknown>> };
    expect(out.items[0]?.['token']).toBe('[REDACTED]');
    expect(out.items[1]?.['label']).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// Redaction applied during logging
// ---------------------------------------------------------------------------

describe('Logger — automatic redaction during emit', () => {
  it('redacts secret fields passed as extra fields', () => {
    const { entries, logger } = captureLogs('info');
    logger.info('login attempt', { email: 'bob@example.com', password: 'oops' });
    expect(entries[0]?.['email']).toBe('[REDACTED]');
    expect(entries[0]?.['password']).toBe('[REDACTED]');
  });

  it('redacts secret fields in the logger context', () => {
    const entries: LogEntry[] = [];
    const log = new Logger({
      level: 'info',
      context: { apiKey: 'sk-secret' },
      sink: (e) => entries.push(e),
    });
    log.info('ping');
    expect(entries[0]?.['apiKey']).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Child logger — context propagation
// ---------------------------------------------------------------------------

describe('Logger — child logger', () => {
  it('inherits parent context fields', () => {
    const entries: LogEntry[] = [];
    const parent = new Logger({
      level: 'info',
      context: { service: 'routes-d' },
      sink: (e) => entries.push(e),
    });
    const child = parent.child({ requestId: 'req-1' });
    child.info('handled');
    expect(entries[0]?.['service']).toBe('routes-d');
    expect(entries[0]?.['requestId']).toBe('req-1');
  });

  it('child context fields override parent fields with same name', () => {
    const entries: LogEntry[] = [];
    const parent = new Logger({
      level: 'info',
      context: { env: 'prod' },
      sink: (e) => entries.push(e),
    });
    const child = parent.child({ env: 'test' });
    child.info('test run');
    expect(entries[0]?.['env']).toBe('test');
  });

  it('child does not pollute parent context', () => {
    const parentEntries: LogEntry[] = [];
    const parent = new Logger({
      level: 'info',
      context: {},
      sink: (e) => parentEntries.push(e),
    });
    parent.child({ requestId: 'req-99' });
    parent.info('from parent');
    expect(parentEntries[0]?.['requestId']).toBeUndefined();
  });

  it('child inherits parent min-level', () => {
    const entries: LogEntry[] = [];
    const parent = new Logger({ level: 'warn', sink: (e) => entries.push(e) });
    const child = parent.child({ traceId: 't1' });
    child.info('suppressed');
    child.warn('visible');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// Integration — Express request logger using child logger
// ---------------------------------------------------------------------------

describe('Logger — per-request child logger pattern', () => {
  it('attaches requestId context to all log lines within a request', () => {
    const entries: LogEntry[] = [];
    const base = new Logger({ level: 'info', sink: (e) => entries.push(e) });

    // Simulate what middleware would do
    const reqLogger = base.child({ requestId: 'abc-123', method: 'POST' });
    reqLogger.info('request received');
    reqLogger.info('validation passed');
    reqLogger.warn('slow db query', { queryMs: 800 });

    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry['requestId']).toBe('abc-123');
      expect(entry['method']).toBe('POST');
    }
    expect(entries[2]?.['queryMs']).toBe(800);
  });
});
