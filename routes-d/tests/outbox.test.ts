import {
  writeEvent,
  getEvent,
  getPendingEvents,
  relayPendingEvents,
  clearOutbox,
  outboxDeps,
} from '../lib/outbox.js';

beforeEach(() => {
  clearOutbox();
  outboxDeps.deliverWebhook = jest.fn().mockResolvedValue(undefined);
});

describe('writeEvent', () => {
  it('creates a pending event with the given url and payload', () => {
    const payload = { type: 'payment', amount: 100 };
    const event = writeEvent('https://example.com/hook', payload);

    expect(event.id).toBeTruthy();
    expect(event.url).toBe('https://example.com/hook');
    expect(event.payload).toEqual(payload);
    expect(event.state).toBe('pending');
    expect(event.attempts).toBe(0);
    expect(event.lastAttemptAt).toBeNull();
    expect(event.error).toBeNull();
  });

  it('persists the event in the store', () => {
    const event = writeEvent('https://example.com/hook', {});
    expect(getEvent(event.id)).toBe(event);
  });

  it('writes multiple events transactionally (each gets a unique id)', () => {
    const a = writeEvent('https://example.com/a', { n: 1 });
    const b = writeEvent('https://example.com/b', { n: 2 });

    expect(a.id).not.toBe(b.id);
    expect(getPendingEvents()).toHaveLength(2);
  });
});

describe('relayPendingEvents - deliver', () => {
  it('dispatches pending events to the webhook url', async () => {
    const event = writeEvent('https://example.com/hook', { x: 1 });
    const result = await relayPendingEvents();

    expect(result.delivered).toBe(1);
    expect(event.state).toBe('delivered');
    expect(event.error).toBeNull();
    expect(outboxDeps.deliverWebhook).toHaveBeenCalledWith(
      'https://example.com/hook',
      { x: 1 },
    );
  });

  it('marks the event delivered and sets lastAttemptAt', async () => {
    const before = Date.now();
    const event = writeEvent('https://example.com/hook', {});
    await relayPendingEvents();

    expect(event.lastAttemptAt).toBeGreaterThanOrEqual(before);
    expect(event.state).toBe('delivered');
  });

  it('does not re-process already-delivered events', async () => {
    writeEvent('https://example.com/hook', {});
    await relayPendingEvents();
    await relayPendingEvents();

    expect(outboxDeps.deliverWebhook).toHaveBeenCalledTimes(1);
  });
});

describe('relayPendingEvents - retry', () => {
  it('keeps the event pending after a transient failure', async () => {
    (outboxDeps.deliverWebhook as jest.Mock).mockRejectedValue(
      new Error('timeout'),
    );

    const event = writeEvent('https://example.com/hook', {});
    const result = await relayPendingEvents();

    expect(result.retrying).toBe(1);
    expect(event.state).toBe('pending');
    expect(event.attempts).toBe(1);
    expect(event.error).toBe('timeout');
  });

  it('increments attempts on each relay call', async () => {
    (outboxDeps.deliverWebhook as jest.Mock).mockRejectedValue(
      new Error('fail'),
    );

    const event = writeEvent('https://example.com/hook', {});
    await relayPendingEvents();
    await relayPendingEvents();

    expect(event.attempts).toBe(2);
  });

  it('marks event failed after MAX_ATTEMPTS (5) consecutive failures', async () => {
    (outboxDeps.deliverWebhook as jest.Mock).mockRejectedValue(
      new Error('persistent failure'),
    );

    const event = writeEvent('https://example.com/hook', {});
    for (let i = 0; i < 5; i++) {
      await relayPendingEvents();
    }

    const result = await relayPendingEvents();
    expect(result.failed).toBe(0); // already marked failed, no longer pending
    expect(event.state).toBe('failed');
    expect(event.attempts).toBe(5);
  });
});

describe('crash recovery', () => {
  it('pending events survive a relay restart (remain in store)', () => {
    (outboxDeps.deliverWebhook as jest.Mock).mockRejectedValue(
      new Error('crash'),
    );

    const event = writeEvent('https://example.com/hook', { important: true });

    expect(getPendingEvents()).toContain(event);
    expect(event.state).toBe('pending');
  });

  it('resumes delivery after a crash (state preserved between relay calls)', async () => {
    let callCount = 0;
    (outboxDeps.deliverWebhook as jest.Mock).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('crash on first attempt');
    });

    const event = writeEvent('https://example.com/hook', {});

    const first = await relayPendingEvents();
    expect(first.retrying).toBe(1);
    expect(event.state).toBe('pending');

    const second = await relayPendingEvents();
    expect(second.delivered).toBe(1);
    expect(event.state).toBe('delivered');
  });
});
