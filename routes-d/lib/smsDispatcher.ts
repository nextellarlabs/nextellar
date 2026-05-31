export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsProvider {
  send(to: string, body: string): Promise<void>;
}

export class SmsDispatcherError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_NUMBER' | 'RATE_LIMITED' | 'SEND_FAILED',
  ) {
    super(message);
    this.name = 'SmsDispatcherError';
  }
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
const DIGIT_RE = /\D/g;

export function normalizeE164(raw: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new SmsDispatcherError(`Invalid phone number: ${raw}`, 'INVALID_NUMBER');
  }

  const trimmed = raw.trim();
  const withPlus = trimmed.startsWith('+') ? trimmed : '+' + trimmed;
  const prefix = '+';
  const digits = withPlus.slice(1).replace(DIGIT_RE, '');
  const normalized = prefix + digits;

  if (!E164_RE.test(normalized)) {
    throw new SmsDispatcherError(
      `Phone number does not conform to E.164: ${raw}`,
      'INVALID_NUMBER',
    );
  }

  return normalized;
}

const SMS_RATE_LIMIT = 5;
const SMS_RATE_WINDOW_MS = 60_000;

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function getBucket(number: string, now: number): RateBucket {
  const existing = rateBuckets.get(number);
  if (!existing || existing.resetAt <= now) {
    const bucket: RateBucket = { count: 0, resetAt: now + SMS_RATE_WINDOW_MS };
    rateBuckets.set(number, bucket);
    return bucket;
  }
  return existing;
}

export const smsDispatcherDeps: { provider: SmsProvider } = {
  provider: {
    async send(_to: string, _body: string): Promise<void> {},
  },
};

export async function dispatchSms(payload: SmsPayload): Promise<{ to: string }> {
  const normalized = normalizeE164(payload.to);
  const now = Date.now();
  const bucket = getBucket(normalized, now);

  if (bucket.count >= SMS_RATE_LIMIT) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw new SmsDispatcherError(
      `Rate limit exceeded for ${normalized}. Retry after ${retryAfter}s.`,
      'RATE_LIMITED',
    );
  }

  bucket.count += 1;

  try {
    await smsDispatcherDeps.provider.send(normalized, payload.body);
  } catch (err) {
    bucket.count -= 1;
    const message = err instanceof Error ? err.message : String(err);
    throw new SmsDispatcherError(`Send failed: ${message}`, 'SEND_FAILED');
  }

  return { to: normalized };
}

export function __resetSmsRateLimitState(): void {
  rateBuckets.clear();
}
