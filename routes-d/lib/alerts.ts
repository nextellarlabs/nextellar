/**
 * Pluggable error-rate alerting for routes-d.
 *
 * Each route is tracked in a sliding window. When the error rate (5xx / total)
 * exceeds the configured threshold for a minimum request count, the registered
 * sinks (PagerDuty, Slack, etc.) receive an AlertEvent.
 *
 * The alert fires once when the rate first crosses the threshold (spike onset)
 * and re-fires if the spike persists after the window has fully rolled over
 * (sustained spike). It does not fire again while the route is continuously
 * above the threshold — callers get one notification per onset.
 */

export type AlertSink = (event: AlertEvent) => void | Promise<void>;

export interface AlertEvent {
  type: 'error_rate_spike';
  route: string;
  /** Observed error rate at the moment of firing (0–1). */
  rate: number;
  /** Configured threshold that was crossed. */
  threshold: number;
  /** Sliding window size in milliseconds. */
  windowMs: number;
  triggeredAt: string;
}

export interface AlertsOptions {
  /** Sliding window size in milliseconds. Default: 60_000. */
  windowMs?: number;
  /**
   * Error-rate threshold (0–1) above which an alert fires.
   * Default: 0.1 (10 %).
   */
  threshold?: number;
  /**
   * Minimum requests in the window before the threshold is evaluated.
   * Prevents noise on low-traffic routes.
   * Default: 10.
   */
  minRequests?: number;
  /** Pluggable alert destinations (PagerDuty, Slack webhook, etc.). */
  sinks?: AlertSink[];
  /** Injectable clock for deterministic testing. */
  now?: () => number;
}

export interface RouteStats {
  /** Requests in the current window. */
  total: number;
  /** 5xx responses in the current window. */
  errors: number;
  /** `errors / total`, or 0 when total is 0. */
  rate: number;
}

export interface AlertsTracker {
  /** Record a completed request for a route with its HTTP status code. */
  record(route: string, statusCode: number): void;
  /** Return a live snapshot of the current window stats for a route. */
  stats(route: string): RouteStats;
  /** Wipe all route windows — useful between tests. */
  reset(): void;
}

interface Hit {
  ts: number;
  isError: boolean;
}

interface RouteWindow {
  hits: Hit[];
  /** True while the route is above threshold — prevents duplicate alerts. */
  firing: boolean;
}

export function createAlertsTracker(options: AlertsOptions = {}): AlertsTracker {
  const windowMs = options.windowMs ?? 60_000;
  const threshold = options.threshold ?? 0.1;
  const minRequests = options.minRequests ?? 10;
  const sinks: AlertSink[] = options.sinks ?? [];
  const getNow = options.now ?? Date.now;

  const windows = new Map<string, RouteWindow>();

  function getWindow(route: string): RouteWindow {
    let w = windows.get(route);
    if (!w) {
      w = { hits: [], firing: false };
      windows.set(route, w);
    }
    return w;
  }

  function prune(w: RouteWindow, now: number): void {
    const cutoff = now - windowMs;
    w.hits = w.hits.filter((h) => h.ts > cutoff);
  }

  function computeStats(w: RouteWindow): RouteStats {
    const total = w.hits.length;
    const errors = w.hits.filter((h) => h.isError).length;
    return { total, errors, rate: total === 0 ? 0 : errors / total };
  }

  function fire(route: string, rate: number, now: number): void {
    const event: AlertEvent = {
      type: 'error_rate_spike',
      route,
      rate,
      threshold,
      windowMs,
      triggeredAt: new Date(now).toISOString(),
    };
    for (const sink of sinks) {
      try {
        void sink(event);
      } catch {
        // Alerting must never disrupt the request path.
      }
    }
  }

  return {
    record(route: string, statusCode: number): void {
      const now = getNow();
      const w = getWindow(route);
      prune(w, now);

      w.hits.push({ ts: now, isError: statusCode >= 500 });

      const { total, rate } = computeStats(w);

      if (total >= minRequests && rate > threshold) {
        if (!w.firing) {
          w.firing = true;
          fire(route, rate, now);
        }
      } else {
        // Rate has dropped below threshold — reset so the next spike fires again.
        w.firing = false;
      }
    },

    stats(route: string): RouteStats {
      const now = getNow();
      const w = getWindow(route);
      prune(w, now);
      return computeStats(w);
    },

    reset(): void {
      windows.clear();
    },
  };
}
