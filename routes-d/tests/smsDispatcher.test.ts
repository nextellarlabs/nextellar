import {
  dispatchSms,
  smsDispatcherDeps,
  normalizeE164,
  SmsDispatcherError,
  __resetSmsRateLimitState,
} from '../lib/smsDispatcher.js';

beforeEach(() => {
  __resetSmsRateLimitState();
  smsDispatcherDeps.provider = {
    send: jest.fn().mockResolvedValue(undefined),
  };
});

describe('normalizeE164', () => {
  it('keeps a valid E.164 number unchanged', () => {
    expect(normalizeE164('+14155552671')).toBe('+14155552671');
  });

  it('strips spaces and dashes, prepends + when missing', () => {
    expect(normalizeE164('1 415 555 2671')).toBe('+14155552671');
  });

  it('strips parentheses and hyphens', () => {
    expect(normalizeE164('+1 (415) 555-2671')).toBe('+14155552671');
  });

  it('throws INVALID_NUMBER for a number that is too short', () => {
    expect(() => normalizeE164('+123')).toThrow(SmsDispatcherError);
    try {
      normalizeE164('+123');
    } catch (err) {
      expect((err as SmsDispatcherError).code).toBe('INVALID_NUMBER');
    }
  });

  it('throws INVALID_NUMBER for empty string', () => {
    expect(() => normalizeE164('')).toThrow(SmsDispatcherError);
  });

  it('throws INVALID_NUMBER for a non-digit string', () => {
    expect(() => normalizeE164('not-a-phone')).toThrow(SmsDispatcherError);
  });
});

describe('dispatchSms', () => {
  it('sends SMS through the provider and returns normalized number', async () => {
    const result = await dispatchSms({ to: '+14155552671', body: 'Hello' });

    expect(result.to).toBe('+14155552671');
    expect(smsDispatcherDeps.provider.send).toHaveBeenCalledWith(
      '+14155552671',
      'Hello',
    );
  });

  it('normalizes the number before sending', async () => {
    await dispatchSms({ to: '1 415 555 2671', body: 'Hi' });

    expect(smsDispatcherDeps.provider.send).toHaveBeenCalledWith(
      '+14155552671',
      'Hi',
    );
  });

  it('throws INVALID_NUMBER for a bad number and does not call the provider', async () => {
    await expect(dispatchSms({ to: 'bad', body: 'x' })).rejects.toThrow(
      SmsDispatcherError,
    );
    expect(smsDispatcherDeps.provider.send).not.toHaveBeenCalled();
  });

  it('throws SEND_FAILED when the provider rejects and does not count the attempt', async () => {
    (smsDispatcherDeps.provider.send as jest.Mock).mockRejectedValue(
      new Error('network error'),
    );

    await expect(
      dispatchSms({ to: '+14155552671', body: 'x' }),
    ).rejects.toMatchObject({ code: 'SEND_FAILED' });

    // attempt was rolled back so the same number can still send up to the limit
    const successes: string[] = [];
    (smsDispatcherDeps.provider.send as jest.Mock).mockResolvedValue(undefined);
    for (let i = 0; i < 5; i++) {
      const r = await dispatchSms({ to: '+14155552671', body: 'ok' });
      successes.push(r.to);
    }
    expect(successes).toHaveLength(5);
  });

  describe('rate limiting', () => {
    it('allows up to 5 sends per window', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          dispatchSms({ to: '+14155552671', body: `msg ${i}` }),
        ).resolves.toBeDefined();
      }
    });

    it('throttles after 5 sends within the window', async () => {
      for (let i = 0; i < 5; i++) {
        await dispatchSms({ to: '+14155552671', body: `msg ${i}` });
      }

      await expect(
        dispatchSms({ to: '+14155552671', body: 'over limit' }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('rate limits per destination independently', async () => {
      for (let i = 0; i < 5; i++) {
        await dispatchSms({ to: '+14155552671', body: `msg ${i}` });
      }

      await expect(
        dispatchSms({ to: '+447911123456', body: 'different number' }),
      ).resolves.toBeDefined();
    });
  });
});
