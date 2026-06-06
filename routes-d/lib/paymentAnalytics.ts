export type AnalyticsWindow = "daily" | "weekly";

export interface PaymentAnalyticsRecord {
  id: string;
  amount: number;
  currency: string;
  createdAt: number;
}

export interface PaymentAnalyticsBucket {
  periodStart: string;
  periodEnd: string;
  count: number;
  totalAmount: number;
  currencies: Record<string, { count: number; totalAmount: number }>;
}

export interface PaymentAnalyticsResult {
  window: AnalyticsWindow;
  from: string;
  to: string;
  buckets: PaymentAnalyticsBucket[];
}

export interface PaymentAnalyticsStore {
  listBetween(fromMs: number, toMs: number): Promise<PaymentAnalyticsRecord[]>;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUtcWeek(ms: number): number {
  const dayStart = startOfUtcDay(ms);
  const d = new Date(dayStart);
  const weekday = d.getUTCDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  return dayStart - diff * DAY_MS;
}

export function aggregatePayments(
  records: PaymentAnalyticsRecord[],
  window: AnalyticsWindow,
  fromMs: number,
  toMs: number,
): PaymentAnalyticsResult {
  const bucketMs = window === "daily" ? DAY_MS : WEEK_MS;
  const bucketStartFn = window === "daily" ? startOfUtcDay : startOfUtcWeek;
  const buckets = new Map<number, PaymentAnalyticsBucket>();

  for (const record of records) {
    if (record.createdAt < fromMs || record.createdAt >= toMs) continue;
    const key = bucketStartFn(record.createdAt);
    let bucket = buckets.get(key);
    if (!bucket) {
      const periodEndMs = key + bucketMs;
      bucket = {
        periodStart: new Date(key).toISOString(),
        periodEnd: new Date(periodEndMs).toISOString(),
        count: 0,
        totalAmount: 0,
        currencies: {},
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.totalAmount += record.amount;
    const cur = bucket.currencies[record.currency] ?? { count: 0, totalAmount: 0 };
    cur.count += 1;
    cur.totalAmount += record.amount;
    bucket.currencies[record.currency] = cur;
  }

  return {
    window,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    buckets: [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, bucket]) => bucket),
  };
}

export interface AnalyticsCacheEntry {
  expiresAt: number;
  payload: PaymentAnalyticsResult;
}

export class AnalyticsCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, AnalyticsCacheEntry>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string, now = Date.now()): PaymentAnalyticsResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.payload;
  }

  set(key: string, payload: PaymentAnalyticsResult, now = Date.now()): void {
    this.entries.set(key, { payload, expiresAt: now + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

export function cacheKey(window: AnalyticsWindow, fromMs: number, toMs: number): string {
  return `${window}:${fromMs}:${toMs}`;
}

export async function getPaymentAnalytics(
  store: PaymentAnalyticsStore,
  cache: AnalyticsCache,
  window: AnalyticsWindow,
  fromMs: number,
  toMs: number,
  now = Date.now(),
): Promise<{ result: PaymentAnalyticsResult; cacheHit: boolean }> {
  const key = cacheKey(window, fromMs, toMs);
  const cached = cache.get(key, now);
  if (cached) {
    return { result: cached, cacheHit: true };
  }
  const records = await store.listBetween(fromMs, toMs);
  const result = aggregatePayments(records, window, fromMs, toMs);
  cache.set(key, result, now);
  return { result, cacheHit: false };
}
