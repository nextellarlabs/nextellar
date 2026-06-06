import { jest } from '@jest/globals';
import { createAlertsTracker, type AlertEvent, type AlertSink } from '../lib/alerts.js';

// Helpers

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

// ── Normal traffic (no alert) ──────────────────────────────────────────────

describe('createAlertsTracker — normal traffic', () => {
  it('does not fire when error rate is below the threshold', () => {
    const fired: AlertEvent[] = [];
    const sink: AlertSink = (e) => fired.push(e);
    const tracker = createAlertsTracker({ threshold: 0.1, minRequests: 5, sinks: [sink] });

    for (let i = 0; i < 9; i++) tracker.record('/api/orders', 200);
    tracker.record('/api/orders', 500);

    expect(fired).toHaveLength(0);
  });

  it('does not fire before minRequests is reached even if all are errors', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 10,
      sinks: [(e) => fired.push(e)],
    });

    for (let i = 0; i < 9; i++) tracker.record('/api/payments', 500);

    expect(fired).toHaveLength(0);
  });
});

// ── Spike detection ────────────────────────────────────────────────────────

describe('createAlertsTracker — spike detection', () => {
  it('fires once when error rate crosses the threshold', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.2,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
    });

    for (let i = 0; i < 4; i++) tracker.record('/api/orders', 200);
    tracker.record('/api/orders', 500);
    tracker.record('/api/orders', 500); // rate = 2/6 ≈ 0.33 → above threshold

    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      type: 'error_rate_spike',
      route: '/api/orders',
      threshold: 0.2,
    });
    expect(fired[0]!.rate).toBeGreaterThan(0.2);
  });

  it('does not fire repeatedly while the route stays above threshold', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
    });

    for (let i = 0; i < 4; i++) tracker.record('/api/orders', 200);
    for (let i = 0; i < 10; i++) tracker.record('/api/orders', 500);

    expect(fired).toHaveLength(1);
  });

  it('fires on each distinct spike onset separated by recovery', () => {
    const clock = makeClock(1_000_000);
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      windowMs: 1000,
      threshold: 0.5,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
      now: clock.now,
    });

    // First spike
    for (let i = 0; i < 2; i++) tracker.record('/api/orders', 200);
    for (let i = 0; i < 4; i++) tracker.record('/api/orders', 500); // 4/6 ≈ 0.67 → spike

    expect(fired).toHaveLength(1);

    // Recovery — advance past the window so all spike hits roll off
    clock.advance(1500);
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 200);

    expect(fired).toHaveLength(1); // no new alert during recovery

    // Second spike
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500); // rate > 0.5 again

    expect(fired).toHaveLength(2);
  });
});

// ── Sustained spike ────────────────────────────────────────────────────────

describe('createAlertsTracker — sustained spike', () => {
  it('fires again when the window fully rolls over while still above threshold', () => {
    const clock = makeClock(0);
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      windowMs: 1000,
      threshold: 0.5,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
      now: clock.now,
    });

    // Fill window with errors → first alert
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);
    expect(fired).toHaveLength(1);

    // Advance past the window so old hits roll off, then re-spike
    clock.advance(1500);
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);

    expect(fired).toHaveLength(2);
  });
});

// ── Route isolation ────────────────────────────────────────────────────────

describe('createAlertsTracker — route isolation', () => {
  it('tracks each route independently', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.5,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
    });

    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);
    for (let i = 0; i < 10; i++) tracker.record('/api/payments', 200);

    expect(fired).toHaveLength(1);
    expect(fired[0]!.route).toBe('/api/orders');

    const orderStats = tracker.stats('/api/orders');
    const paymentStats = tracker.stats('/api/payments');
    expect(orderStats.rate).toBeGreaterThan(0.5);
    expect(paymentStats.rate).toBe(0);
  });
});

// ── stats() ────────────────────────────────────────────────────────────────

describe('createAlertsTracker — stats()', () => {
  it('returns zeros for an unknown route', () => {
    const tracker = createAlertsTracker();
    expect(tracker.stats('/unknown')).toEqual({ total: 0, errors: 0, rate: 0 });
  });

  it('correctly counts totals and errors', () => {
    const tracker = createAlertsTracker({ threshold: 1, minRequests: 100 });
    for (let i = 0; i < 7; i++) tracker.record('/r', 200);
    for (let i = 0; i < 3; i++) tracker.record('/r', 500);

    const s = tracker.stats('/r');
    expect(s.total).toBe(10);
    expect(s.errors).toBe(3);
    expect(s.rate).toBeCloseTo(0.3);
  });

  it('prunes hits outside the window from stats()', () => {
    const clock = makeClock(0);
    const tracker = createAlertsTracker({ windowMs: 1000, threshold: 1, now: clock.now });

    for (let i = 0; i < 5; i++) tracker.record('/r', 500);

    clock.advance(1500);

    const s = tracker.stats('/r');
    expect(s.total).toBe(0);
    expect(s.errors).toBe(0);
  });
});

// ── reset() ───────────────────────────────────────────────────────────────

describe('createAlertsTracker — reset()', () => {
  it('clears all windows and resets firing state', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
    });

    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);
    expect(fired).toHaveLength(1);

    tracker.reset();

    // After reset the window is empty → stats returns zero
    expect(tracker.stats('/api/orders')).toEqual({ total: 0, errors: 0, rate: 0 });

    // And firing state is cleared so a new spike triggers a fresh alert
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);
    expect(fired).toHaveLength(2);
  });
});

// ── Sink resilience ────────────────────────────────────────────────────────

describe('createAlertsTracker — sink resilience', () => {
  it('continues recording even when a sink throws', () => {
    const good: AlertEvent[] = [];
    const throwing: AlertSink = () => { throw new Error('slack is down'); };
    const catching: AlertSink = (e) => good.push(e);

    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [throwing, catching],
    });

    expect(() => {
      for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);
    }).not.toThrow();

    expect(good).toHaveLength(1);
  });

  it('calls all registered sinks', () => {
    const calls: string[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [
        () => calls.push('sink-a'),
        () => calls.push('sink-b'),
      ],
    });

    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);

    expect(calls).toContain('sink-a');
    expect(calls).toContain('sink-b');
  });
});

// ── AlertEvent shape ───────────────────────────────────────────────────────

describe('createAlertsTracker — AlertEvent shape', () => {
  it('includes a valid ISO-8601 triggeredAt timestamp', () => {
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
    });
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);

    expect(fired[0]!.triggeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(fired[0]!.windowMs).toBeGreaterThan(0);
  });

  it('uses the injected clock for triggeredAt', () => {
    const FIXED_TS = 1_700_000_000_000;
    const fired: AlertEvent[] = [];
    const tracker = createAlertsTracker({
      threshold: 0.1,
      minRequests: 5,
      sinks: [(e) => fired.push(e)],
      now: () => FIXED_TS,
    });
    for (let i = 0; i < 5; i++) tracker.record('/api/orders', 500);

    expect(fired[0]!.triggeredAt).toBe(new Date(FIXED_TS).toISOString());
  });
});
