// Structured JSON logger for routes-d (Issue #326).
//
// Design goals:
//   - Every log line is a single JSON object written to a configurable sink.
//   - Level filtering: only lines at or above the configured minimum level
//     are emitted.
//   - Context fields: attached once to a logger and merged into every line.
//   - Child loggers: inherit parent context and add their own (useful for
//     per-request loggers that carry traceId, userId, route, etc.).
//   - Automatic redaction: a known set of PII and secret field names is
//     replaced with '[REDACTED]' before serialisation. Redaction is
//     recursive and applies to nested objects.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to LOG_LEVEL env var, then 'info'. */
  level?: LogLevel;
  /** Fields merged into every log entry produced by this logger. */
  context?: LogContext;
  /** Override the write sink (useful for testing). Defaults to stdout. */
  sink?: (entry: LogEntry) => void;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

// Field names (matched case-insensitively) whose values are always redacted.
const REDACT_EXACT = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'auth',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'secretkey',
  'secret_key',
  'ssn',
  'sin',
  'taxid',
  'tax_id',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'pan',
  'email',
  'phone',
  'mobile',
  'phonenumber',
  'phone_number',
]);

// Substrings that trigger redaction when found in a field name.
const REDACT_CONTAINS = ['secret', 'password', 'token', 'apikey', 'api_key', 'auth'];

const REDACTED = '[REDACTED]';

function shouldRedact(key: string): boolean {
  const lc = key.toLowerCase().replace(/[-\s]/g, '_');
  if (REDACT_EXACT.has(lc)) return true;
  return REDACT_CONTAINS.some((sub) => lc.includes(sub));
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = shouldRedact(k) ? REDACTED : redactDeep(v, depth + 1);
  }
  return result;
}

export function redactContext(ctx: LogContext): LogContext {
  return redactDeep(ctx) as LogContext;
}

// ---------------------------------------------------------------------------
// Level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveEnvLevel(): LogLevel {
  const env = process.env['LOG_LEVEL']?.toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return 'info';
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class Logger {
  private readonly minLevel: LogLevel;
  private readonly context: LogContext;
  private readonly sink: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.level ?? resolveEnvLevel();
    this.context = options.context ?? {};
    this.sink =
      options.sink ??
      ((entry) => process.stdout.write(JSON.stringify(entry) + '\n'));
  }

  private emit(level: LogLevel, msg: string, fields?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...(redactContext(this.context) as object),
      ...(fields ? (redactContext(fields) as object) : {}),
    };
    this.sink(entry);
  }

  debug(msg: string, fields?: LogContext): void {
    this.emit('debug', msg, fields);
  }

  info(msg: string, fields?: LogContext): void {
    this.emit('info', msg, fields);
  }

  warn(msg: string, fields?: LogContext): void {
    this.emit('warn', msg, fields);
  }

  error(msg: string, fields?: LogContext): void {
    this.emit('error', msg, fields);
  }

  /**
   * Returns a new logger that inherits this logger's level and sink but adds
   * `context` fields on top of the parent's context. Use this to create a
   * per-request child logger that always emits the request's traceId etc.
   */
  child(context: LogContext): Logger {
    return new Logger({
      level: this.minLevel,
      context: { ...this.context, ...context },
      sink: this.sink,
    });
  }
}

/** Module-level singleton logger. Configure once at startup. */
export const logger = new Logger();
