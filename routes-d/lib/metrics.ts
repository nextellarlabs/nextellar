type LabelValues = {
  route: string;
  method: string;
  status: string;
};

interface CounterEntry extends LabelValues {
  value: number;
}

interface HistogramEntry extends LabelValues {
  buckets: Map<number, number>;
  sumMs: number;
  count: number;
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const requestCounters = new Map<string, CounterEntry>();
const requestErrors = new Map<string, CounterEntry>();
const requestLatency = new Map<string, HistogramEntry>();

function key(labels: LabelValues): string {
  return `${labels.route}|${labels.method}|${labels.status}`;
}

export function resetMetrics(): void {
  requestCounters.clear();
  requestErrors.clear();
  requestLatency.clear();
}

export function recordRequest(route: string, method: string, status: number, durationMs: number): void {
  const statusLabel = String(status);
  const labelKey = key({ route, method, status: statusLabel });
  const counter = requestCounters.get(labelKey) ?? { route, method, status: statusLabel, value: 0 };
  counter.value += 1;
  requestCounters.set(labelKey, counter);

  const latencyKey = key({ route, method, status: statusLabel });
  const histogram = requestLatency.get(latencyKey) ?? {
    route,
    method,
    status: statusLabel,
    buckets: new Map(DEFAULT_BUCKETS.map((bucket) => [bucket, 0])),
    sumMs: 0,
    count: 0,
  };
  histogram.sumMs += durationMs;
  histogram.count += 1;
  for (const bucket of DEFAULT_BUCKETS) {
    if (durationMs <= bucket) {
      histogram.buckets.set(bucket, (histogram.buckets.get(bucket) ?? 0) + 1);
    }
  }
  requestLatency.set(latencyKey, histogram);

  if (status >= 500) {
    const errKey = key({ route, method, status: statusLabel });
    const error = requestErrors.get(errKey) ?? { route, method, status: statusLabel, value: 0 };
    error.value += 1;
    requestErrors.set(errKey, error);
  }
}

function renderLabels(labels: LabelValues): string {
  return `{route="${labels.route}",method="${labels.method}",status="${labels.status}"}`;
}

function renderHistogramLabels(labels: LabelValues, bucket: string): string {
  return `{route="${labels.route}",method="${labels.method}",status="${labels.status}",le="${bucket}"}`;
}

export function renderMetrics(): string {
  const lines: string[] = [];
  lines.push("# HELP nextellar_http_requests_total Total HTTP requests observed by routes-d.");
  lines.push("# TYPE nextellar_http_requests_total counter");
  for (const entry of requestCounters.values()) {
    lines.push(`nextellar_http_requests_total${renderLabels(entry)} ${entry.value}`);
  }

  lines.push("# HELP nextellar_http_request_errors_total Total HTTP error responses observed by routes-d.");
  lines.push("# TYPE nextellar_http_request_errors_total counter");
  for (const entry of requestErrors.values()) {
    lines.push(`nextellar_http_request_errors_total${renderLabels(entry)} ${entry.value}`);
  }

  lines.push("# HELP nextellar_http_request_duration_ms Request duration histogram in milliseconds.");
  lines.push("# TYPE nextellar_http_request_duration_ms histogram");
  for (const entry of requestLatency.values()) {
    for (const bucket of DEFAULT_BUCKETS) {
      const count = entry.buckets.get(bucket) ?? 0;
      lines.push(`nextellar_http_request_duration_ms_bucket${renderHistogramLabels(entry, String(bucket))} ${count}`);
    }
    lines.push(`nextellar_http_request_duration_ms_bucket${renderHistogramLabels(entry, "+Inf")} ${entry.count}`);
    lines.push(`nextellar_http_request_duration_ms_sum${renderLabels(entry)} ${entry.sumMs}`);
    lines.push(`nextellar_http_request_duration_ms_count${renderLabels(entry)} ${entry.count}`);
  }

  return `${lines.join("\n")}\n`;
}
