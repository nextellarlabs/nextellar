/**
 * Unit tests for routes-d/lib/pushDispatcher.ts
 *
 * Covers:
 *  - Token registration, retrieval, and removal
 *  - Quiet-hours detection (wrapping and non-wrapping windows)
 *  - Successful APNs / FCM dispatch
 *  - Stale-token cleanup on permanent provider errors
 *  - Quiet-hours skipping
 *  - Missing provider configuration
 */

import {
  PushDispatcher,
  isInQuietHours,
  registerTokens,
  removeToken,
  getTokens,
  removeAllTokens,
  __resetTokenStore,
  __seedTokens,
  type DeviceToken,
  type APNsProvider,
  type FCMProvider,
  type PushPayload,
} from '../../lib/pushDispatcher.js';

// ---------------------------------------------------------------------------
// Helpers – plain spy factories (no jest globals needed)
// ---------------------------------------------------------------------------

const basePayload: PushPayload = { title: 'Test', body: 'Hello world' };

function makeApns(
  resp: Awaited<ReturnType<APNsProvider['send']>>,
): APNsProvider & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    send: (...args) => { calls.push(args); return Promise.resolve(resp); },
  };
}

function makeFcm(
  resp: Awaited<ReturnType<FCMProvider['send']>>,
): FCMProvider & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    send: (...args) => { calls.push(args); return Promise.resolve(resp); },
  };
}

function makeToken(
  overrides: Partial<DeviceToken> & Pick<DeviceToken, 'token' | 'platform'>,
): DeviceToken {
  return { registeredAt: '2025-01-01T00:00:00Z', ...overrides };
}

beforeEach(() => { __resetTokenStore(); });

// ---------------------------------------------------------------------------
// Token store
// ---------------------------------------------------------------------------

describe('registerTokens', () => {
  it('stores tokens for a new user', () => {
    registerTokens('u1', [{ token: 'tok-a', platform: 'apns' }]);
    const stored = getTokens('u1');
    expect(stored).toHaveLength(1);
    expect(stored[0].token).toBe('tok-a');
    expect(stored[0].platform).toBe('apns');
  });

  it('adds multiple tokens in a single call', () => {
    registerTokens('u1', [
      { token: 'tok-a', platform: 'apns' },
      { token: 'tok-b', platform: 'fcm' },
    ]);
    expect(getTokens('u1')).toHaveLength(2);
  });

  it('deduplicates by token string (upsert)', () => {
    registerTokens('u1', [{ token: 'tok-a', platform: 'apns' }]);
    registerTokens('u1', [{ token: 'tok-a', platform: 'apns', timezone: 'UTC' }]);
    const tokens = getTokens('u1');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].timezone).toBe('UTC');
  });

  it('preserves registeredAt on upsert', () => {
    registerTokens('u1', [{ token: 'tok-a', platform: 'apns' }]);
    const original = getTokens('u1')[0].registeredAt;
    registerTokens('u1', [{ token: 'tok-a', platform: 'apns', timezone: 'Europe/London' }]);
    expect(getTokens('u1')[0].registeredAt).toBe(original);
  });

  it('throws when userId is empty', () => {
    expect(() => registerTokens('', [{ token: 'tok', platform: 'apns' }])).toThrow('userId is required');
  });

  it('throws when token string is empty', () => {
    expect(() => registerTokens('u1', [{ token: '', platform: 'apns' }])).toThrow('device token string is required');
  });
});

describe('removeToken', () => {
  it('removes a specific token', () => {
    __seedTokens('u1', [
      makeToken({ token: 'tok-a', platform: 'apns' }),
      makeToken({ token: 'tok-b', platform: 'fcm' }),
    ]);
    removeToken('u1', 'tok-a');
    const remaining = getTokens('u1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].token).toBe('tok-b');
  });

  it('deletes user record when last token is removed', () => {
    __seedTokens('u1', [makeToken({ token: 'tok-a', platform: 'apns' })]);
    removeToken('u1', 'tok-a');
    expect(getTokens('u1')).toHaveLength(0);
  });

  it('is a no-op for unknown userId', () => {
    expect(() => removeToken('nonexistent', 'tok')).not.toThrow();
  });
});

describe('removeAllTokens', () => {
  it('removes all tokens for a user', () => {
    __seedTokens('u1', [
      makeToken({ token: 'tok-a', platform: 'apns' }),
      makeToken({ token: 'tok-b', platform: 'fcm' }),
    ]);
    removeAllTokens('u1');
    expect(getTokens('u1')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

describe('isInQuietHours', () => {
  it('returns false when quietHours is not set', () => {
    const device = makeToken({ token: 't', platform: 'apns' });
    expect(isInQuietHours(device, new Date())).toBe(false);
  });

  it('detects a non-wrapping quiet window (9→17)', () => {
    const device = makeToken({ token: 't', platform: 'apns', timezone: 'UTC', quietHours: { start: 9, end: 17 } });
    expect(isInQuietHours(device, new Date('2025-06-01T10:00:00Z'))).toBe(true);  // inside
    expect(isInQuietHours(device, new Date('2025-06-01T09:00:00Z'))).toBe(true);  // start inclusive
    expect(isInQuietHours(device, new Date('2025-06-01T17:00:00Z'))).toBe(false); // end exclusive
    expect(isInQuietHours(device, new Date('2025-06-01T08:00:00Z'))).toBe(false); // before window
  });

  it('detects a wrapping quiet window (22→7, crosses midnight)', () => {
    const device = makeToken({ token: 't', platform: 'apns', timezone: 'UTC', quietHours: { start: 22, end: 7 } });
    expect(isInQuietHours(device, new Date('2025-06-01T23:00:00Z'))).toBe(true);  // after start
    expect(isInQuietHours(device, new Date('2025-06-01T02:00:00Z'))).toBe(true);  // before end
    expect(isInQuietHours(device, new Date('2025-06-01T07:00:00Z'))).toBe(false); // end exclusive
    expect(isInQuietHours(device, new Date('2025-06-01T12:00:00Z'))).toBe(false); // outside
  });

  it('falls back to UTC when timezone is invalid', () => {
    const device = makeToken({ token: 't', platform: 'apns', timezone: 'Invalid/Zone', quietHours: { start: 1, end: 2 } });
    expect(() => isInQuietHours(device, new Date('2025-06-01T01:30:00Z'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PushDispatcher – APNs
// ---------------------------------------------------------------------------

describe('PushDispatcher – APNs', () => {
  it('delivers successfully', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-tok', platform: 'apns' })]);
    const apns = makeApns({ success: true });
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload);

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results[0].success).toBe(true);
    expect(apns.calls[0][0]).toBe('apns-tok');
  });

  it('records failure on soft error without removing token', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-tok', platform: 'apns' })]);
    const apns = makeApns({ success: false, reason: 'ServiceUnavailable' });
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload);

    expect(result.failed).toBe(1);
    expect(result.staleTokensRemoved).toBe(0);
    expect(getTokens('u1')).toHaveLength(1);
  });

  it('removes stale token on BadDeviceToken', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-stale', platform: 'apns' })]);
    const apns = makeApns({ success: false, reason: 'BadDeviceToken' });
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload);

    expect(result.staleTokensRemoved).toBe(1);
    expect(result.results[0].tokenRemoved).toBe(true);
    expect(getTokens('u1')).toHaveLength(0);
  });

  it('removes stale token on Unregistered', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-unreg', platform: 'apns' })]);
    await new PushDispatcher({ apns: makeApns({ success: false, reason: 'Unregistered' }) }).sendToUser('u1', basePayload);
    expect(getTokens('u1')).toHaveLength(0);
  });

  it('returns PROVIDER_NOT_CONFIGURED when no APNs provider', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-tok', platform: 'apns' })]);
    const result = await new PushDispatcher({}).sendToUser('u1', basePayload);
    expect(result.results[0].errorCode).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('handles provider throwing an exception', async () => {
    __seedTokens('u1', [makeToken({ token: 'apns-tok', platform: 'apns' })]);
    const apns: APNsProvider = { send: () => Promise.reject(new Error('network timeout')) };
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload);

    expect(result.failed).toBe(1);
    expect(result.results[0].errorCode).toBe('SEND_ERROR');
    expect(result.results[0].errorMessage).toContain('network timeout');
  });
});

// ---------------------------------------------------------------------------
// PushDispatcher – FCM
// ---------------------------------------------------------------------------

describe('PushDispatcher – FCM', () => {
  it('delivers successfully', async () => {
    __seedTokens('u1', [makeToken({ token: 'fcm-tok', platform: 'fcm' })]);
    const fcm = makeFcm({ success: true, messageId: 'msg-123' });
    const result = await new PushDispatcher({ fcm }).sendToUser('u1', basePayload);

    expect(result.delivered).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(fcm.calls[0][0]).toBe('fcm-tok');
  });

  it('removes stale token on registration-token-not-registered', async () => {
    __seedTokens('u1', [makeToken({ token: 'fcm-stale', platform: 'fcm' })]);
    const result = await new PushDispatcher({ fcm: makeFcm({ success: false, errorCode: 'registration-token-not-registered' }) }).sendToUser('u1', basePayload);

    expect(result.staleTokensRemoved).toBe(1);
    expect(getTokens('u1')).toHaveLength(0);
  });

  it('removes stale token on UNREGISTERED', async () => {
    __seedTokens('u1', [makeToken({ token: 'fcm-unreg', platform: 'fcm' })]);
    await new PushDispatcher({ fcm: makeFcm({ success: false, errorCode: 'UNREGISTERED' }) }).sendToUser('u1', basePayload);
    expect(getTokens('u1')).toHaveLength(0);
  });

  it('keeps token on transient FCM error', async () => {
    __seedTokens('u1', [makeToken({ token: 'fcm-tok', platform: 'fcm' })]);
    const result = await new PushDispatcher({ fcm: makeFcm({ success: false, errorCode: 'INTERNAL' }) }).sendToUser('u1', basePayload);

    expect(result.staleTokensRemoved).toBe(0);
    expect(getTokens('u1')).toHaveLength(1);
  });

  it('returns PROVIDER_NOT_CONFIGURED when no FCM provider', async () => {
    __seedTokens('u1', [makeToken({ token: 'fcm-tok', platform: 'fcm' })]);
    const result = await new PushDispatcher({}).sendToUser('u1', basePayload);
    expect(result.results[0].errorCode).toBe('PROVIDER_NOT_CONFIGURED');
  });
});

// ---------------------------------------------------------------------------
// PushDispatcher – quiet hours
// ---------------------------------------------------------------------------

describe('PushDispatcher – quiet hours', () => {
  it('skips delivery during quiet hours', async () => {
    __seedTokens('u1', [makeToken({ token: 'tok-q', platform: 'apns', timezone: 'UTC', quietHours: { start: 22, end: 7 } })]);
    const apns = makeApns({ success: true });
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload, new Date('2025-06-01T23:00:00Z'));

    expect(result.skipped).toBe(1);
    expect(result.delivered).toBe(0);
    expect(result.results[0].skipped).toBe(true);
    expect(result.results[0].skippedReason).toBe('quiet_hours');
    expect(apns.calls).toHaveLength(0);
  });

  it('delivers outside quiet hours', async () => {
    __seedTokens('u1', [makeToken({ token: 'tok-q', platform: 'apns', timezone: 'UTC', quietHours: { start: 22, end: 7 } })]);
    const apns = makeApns({ success: true });
    const result = await new PushDispatcher({ apns }).sendToUser('u1', basePayload, new Date('2025-06-01T12:00:00Z'));

    expect(result.delivered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(apns.calls).toHaveLength(1);
  });

  it('delivers only non-quiet tokens when mixed', async () => {
    __seedTokens('u1', [
      makeToken({ token: 'tok-quiet', platform: 'apns', timezone: 'UTC', quietHours: { start: 22, end: 7 } }),
      makeToken({ token: 'tok-active', platform: 'fcm' }),
    ]);
    const apns = makeApns({ success: true });
    const fcm = makeFcm({ success: true, messageId: 'm1' });
    const result = await new PushDispatcher({ apns, fcm }).sendToUser('u1', basePayload, new Date('2025-06-01T23:00:00Z'));

    expect(result.skipped).toBe(1);
    expect(result.delivered).toBe(1);
    expect(apns.calls).toHaveLength(0);
    expect(fcm.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PushDispatcher – mixed platform fan-out
// ---------------------------------------------------------------------------

describe('PushDispatcher – mixed platform fan-out', () => {
  it('fans out to both APNs and FCM tokens', async () => {
    __seedTokens('u1', [
      makeToken({ token: 'apns-tok', platform: 'apns' }),
      makeToken({ token: 'fcm-tok', platform: 'fcm' }),
    ]);
    const result = await new PushDispatcher({ apns: makeApns({ success: true }), fcm: makeFcm({ success: true, messageId: 'msg-1' }) }).sendToUser('u1', basePayload);

    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
  });

  it('returns empty results for user with no tokens', async () => {
    const result = await new PushDispatcher({ apns: makeApns({ success: true }) }).sendToUser('nobody', basePayload);
    expect(result.delivered).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it('sends payload fields (data, badge, sound) to provider', async () => {
    __seedTokens('u1', [makeToken({ token: 'tok', platform: 'apns' })]);
    let captured: PushPayload | null = null;
    const apns: APNsProvider = { send: (_, p) => { captured = p; return Promise.resolve({ success: true }); } };
    const richPayload: PushPayload = { title: 'Rich', body: 'Notif', data: { deepLink: '/home' }, badge: 3, sound: 'chime' };

    await new PushDispatcher({ apns }).sendToUser('u1', richPayload);

    expect(captured).not.toBeNull();
    expect(captured!.data).toEqual({ deepLink: '/home' });
    expect(captured!.badge).toBe(3);
    expect(captured!.sound).toBe('chime');
  });
});

// ---------------------------------------------------------------------------
// PushDispatcher – sendToTokens (explicit list)
// ---------------------------------------------------------------------------

describe('PushDispatcher.sendToTokens', () => {
  it('delivers to an explicit list of tokens', async () => {
    const apns = makeApns({ success: true });
    const results = await new PushDispatcher({ apns }).sendToTokens(
      [makeToken({ token: 'explicit-tok', platform: 'apns' })],
      basePayload,
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('respects quiet hours on explicit tokens', async () => {
    const apns = makeApns({ success: true });
    const results = await new PushDispatcher({ apns }).sendToTokens(
      [makeToken({ token: 'explicit-quiet', platform: 'apns', timezone: 'UTC', quietHours: { start: 0, end: 23 } })],
      basePayload,
      new Date('2025-06-01T12:00:00Z'),
    );

    expect(results[0].skipped).toBe(true);
    expect(apns.calls).toHaveLength(0);
  });
});
