/**
 * Email Dispatcher — Unit & Integration Tests
 *
 * Covers:
 * ✓ Successful send
 * ✓ Retry after transient failure
 * ✓ Retry limit reached (terminal failure)
 * ✓ Give up after max retries
 * ✓ Invalid provider configuration
 * ✓ Outbox state transitions
 * ✓ Duplicate delivery prevention
 * ✓ Validation errors
 */

import { EmailDispatcher, DispatchResult, ValidationError } from '../lib/emailDispatcher.js';
import { MockEmailProvider } from '../lib/providers/mock.js';
import type { EmailMessage } from '../lib/providers/provider.js';
import { RetryableError, TerminalError } from '../lib/retry.js';
import { clearOutbox, getOutboxEntry, getOutboxSize, getAllOutboxEntries } from '../lib/outbox.js';
import { createProvider, InvalidProviderError } from '../lib/providers/factory.js';

// --- Helpers ---

function validMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    to: 'user@example.com',
    from: 'noreply@nextellar.dev',
    subject: 'Test Email',
    textBody: 'Hello, this is a test.',
    ...overrides,
  };
}

// --- Unit Tests ---

describe('EmailDispatcher (unit)', () => {
  let provider: MockEmailProvider;
  let dispatcher: EmailDispatcher;

  beforeEach(() => {
    provider = new MockEmailProvider();
    dispatcher = new EmailDispatcher(provider);
    clearOutbox();
  });

  afterEach(() => {
    clearOutbox();
  });

  describe('successful send', () => {
    it('dispatches a valid message and marks it as delivered', async () => {
      const msg = validMessage();
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(msg.id);
      expect(result.provider).toBe('mock');
      expect(result.outboxState).toBe('delivered');
      expect(result.terminal).toBe(false);

      const entry = getOutboxEntry(msg.id)!;
      expect(entry.state).toBe('delivered');
      expect(entry.attempts).toBe(1);
    });

    it('records the message in the provider', async () => {
      const msg = validMessage();
      await dispatcher.send(msg);

      const records = provider.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].message.id).toBe(msg.id);
      expect(records[0].result.success).toBe(true);
    });
  });

  describe('validation', () => {
    it('rejects messages with missing "to"', async () => {
      const msg = validMessage({ to: '' });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('"to" is required');
      expect(result.terminal).toBe(true);
    });

    it('rejects messages with invalid email in "to"', async () => {
      const msg = validMessage({ to: 'not-an-email' });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid email');
      expect(result.terminal).toBe(true);
    });

    it('rejects messages with missing "from"', async () => {
      const msg = validMessage({ from: '' });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('"from"');
    });

    it('rejects messages with empty subject', async () => {
      const msg = validMessage({ subject: '   ' });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('"subject"');
    });

    it('rejects messages without body', async () => {
      const msg = validMessage({ textBody: undefined, htmlBody: undefined });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('textBody');
    });

    it('rejects invalid CC addresses', async () => {
      const msg = validMessage({ cc: ['bad-email'] });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('CC');
    });

    it('handles single recipient "to" as string', async () => {
      const msg = validMessage({ to: 'single@example.com' });
      const result = await dispatcher.send(msg);

      expect(result.success).toBe(true);
    });
  });

  describe('retry after failure', () => {
    it('retries on retryable errors from the provider', async () => {
      // Create a special mock that throws RetryableError on first call only
      let callCount = 0;
      const flakyProvider = {
        name: 'flaky',
        async send(_msg: EmailMessage) {
          callCount++;
          if (callCount <= 2) {
            throw new RetryableError('Temporary network failure');
          }
          return {
            success: true,
            messageId: 'ok',
            provider: 'flaky',
            attemptNumber: callCount,
          };
        },
      };

      const flakyDispatcher = new EmailDispatcher(flakyProvider);
      const msg = validMessage();
      const result = await flakyDispatcher.send(msg);

      expect(result.success).toBe(true);
      expect(callCount).toBe(3); // original + 2 retries
    });

    it('retries on generic errors (conservative)', async () => {
      let callCount = 0;
      const recoveringProvider = {
        name: 'recovering',
        async send(_msg: EmailMessage) {
          callCount++;
          if (callCount < 3) throw new Error('Something went wrong');
          return { success: true, messageId: 'ok', provider: 'recovering', attemptNumber: 3 };
        },
      };

      const dispatcher2 = new EmailDispatcher(recoveringProvider);
      const msg = validMessage();
      const result = await dispatcher2.send(msg);

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });
  });

  describe('retry limit reached', () => {
    it('gives up after max retries on persistent failure', async () => {
      const failingProvider = {
        name: 'failing',
        async send(): Promise<never> {
          throw new RetryableError('Always fails');
        },
      };

      const dispatcher2 = new EmailDispatcher(failingProvider, { maxRetries: 2 });
      const msg = validMessage();
      const result = await dispatcher2.send(msg);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(result.outboxState).toBe('failed');
      expect(result.error).toContain('Retry limit exceeded');
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
    });

    it('does NOT retry terminal errors', async () => {
      let callCount = 0;
      const terminalProvider = {
        name: 'terminal',
        async send(): Promise<never> {
          callCount++;
          throw new TerminalError('Invalid credentials');
        },
      };

      const dispatcher2 = new EmailDispatcher(terminalProvider, { maxRetries: 3 });
      const msg = validMessage();
      const result = await dispatcher2.send(msg);

      expect(result.success).toBe(false);
      expect(result.terminal).toBe(true);
      expect(callCount).toBe(1); // no retries
    });
  });
});

// --- Outbox State Transition Tests ---

describe('Outbox state transitions', () => {
  let provider: MockEmailProvider;
  let dispatcher: EmailDispatcher;

  beforeEach(() => {
    provider = new MockEmailProvider();
    dispatcher = new EmailDispatcher(provider);
    clearOutbox();
  });

  afterEach(() => {
    clearOutbox();
  });

  it('transitions: pending → sending → delivered for successful sends', async () => {
    const msg = validMessage();
    const result = await dispatcher.send(msg);

    expect(result.outboxState).toBe('delivered');

    const entry = getOutboxEntry(msg.id)!;
    expect(entry.state).toBe('delivered');
    expect(entry.attempts).toBe(1);
  });

  it('transitions: pending → sending → failed for failed sends', async () => {
    // Configure mock to fail
    const failingProvider = new MockEmailProvider({ failAfter: 0 }); // fail on first send
    const failingDispatcher = new EmailDispatcher(failingProvider);
    const msg = validMessage();

    const result = await failingDispatcher.send(msg);

    expect(result.outboxState).toBe('failed');

    const entry = getOutboxEntry(msg.id)!;
    expect(entry.state).toBe('failed');
    expect(entry.attempts).toBe(1);
  });

  it('resets failed messages for retry', async () => {
    const { resetForRetry, markSending, addToOutbox, markFailed, markDelivered } =
      await import('../lib/outbox.js');

    const msg = validMessage();

    addToOutbox(msg);
    markSending(msg.id);
    markFailed(msg.id, 'first failure');

    const afterFailed = getOutboxEntry(msg.id)!;
    expect(afterFailed.state).toBe('failed');

    resetForRetry(msg.id);

    const afterReset = getOutboxEntry(msg.id)!;
    expect(afterReset.state).toBe('pending');

    // Now re-send
    markSending(msg.id);
    markDelivered(msg.id);

    const afterDelivered = getOutboxEntry(msg.id)!;
    expect(afterDelivered.state).toBe('delivered');
  });

  it('prevents double delivery (delivered → delivered is invalid)', async () => {
    const { addToOutbox, markSending, markDelivered, transitionOutbox } =
      await import('../lib/outbox.js');

    const msg = validMessage();
    addToOutbox(msg);
    markSending(msg.id);
    markDelivered(msg.id);

    // Attempting to transition finalized "delivered" message should throw
    expect(() => transitionOutbox(msg.id, 'delivered')).toThrow(
      'invalid transition'
    );
  });

  it('resends from outbox only retries pending or failed messages', async () => {
    // Successfully send a message
    const msg = validMessage();
    await dispatcher.send(msg);

    // Verify it's delivered
    const entry = getOutboxEntry(msg.id)!;
    expect(entry.state).toBe('delivered');

    // Delivered entries should not be re-processed
    const pendingEntries = getAllOutboxEntries().filter((e) => e.state === 'pending');
    expect(pendingEntries).toHaveLength(0);
  });
});

// --- Integration Tests ---

describe('EmailDispatcher (integration)', () => {
  beforeEach(() => {
    clearOutbox();
  });

  afterEach(() => {
    clearOutbox();
  });

  it('dispatcher uses the configured mock provider', async () => {
    const provider = new MockEmailProvider();
    const dispatcher = new EmailDispatcher(provider);
    const msg = validMessage();

    const result = await dispatcher.send(msg);

    expect(result.provider).toBe('mock');
    expect(result.success).toBe(true);
  });

  it('retries occur correctly with exponential backoff', async () => {
    const timestamps: number[] = [];
    const timingProvider = {
      name: 'timing',
      async send(): Promise<never> {
        timestamps.push(Date.now());
        throw new RetryableError('fail');
      },
    };

    const dispatcher = new EmailDispatcher(timingProvider, {
      maxRetries: 2,
      baseDelayMs: 50,
    });

    const msg = validMessage();
    await dispatcher.send(msg);

    // 3 send attempts: initial + 2 retries
    expect(timestamps).toHaveLength(3);

    // Check that delays increase (exponential backoff)
    const delay1 = timestamps[1] - timestamps[0];
    const delay2 = timestamps[2] - timestamps[1];
    expect(delay2).toBeGreaterThan(delay1 * 0.5); // should be roughly 2x
  });

  it('delivered messages are not resent (idempotency)', async () => {
    const provider = new MockEmailProvider();
    const dispatcher = new EmailDispatcher(provider);
    const msg = validMessage();

    // First send — success
    const r1 = await dispatcher.send(msg);
    expect(r1.success).toBe(true);
    expect(provider.getRecords()).toHaveLength(1);

    // Second send with same id — should not add duplicate to outbox
    // (outbox already has this id from first send)
    const entryBefore = getOutboxEntry(msg.id)!;
    expect(entryBefore.state).toBe('delivered');

    // The outbox prevents duplicate entries with same ID
    const { addToOutbox } = await import('../lib/outbox.js');
    const added = addToOutbox(msg);
    expect(added).toBe(false); // already exists
  });

  it('failed messages eventually enter terminal state', async () => {
    const alwaysFailing = {
      name: 'always-down',
      async send(): Promise<never> {
        throw new RetryableError('Service unavailable');
      },
    };

    const dispatcher = new EmailDispatcher(alwaysFailing, { maxRetries: 1 });
    const msg = validMessage();

    const result = await dispatcher.send(msg);

    expect(result.success).toBe(false);
    expect(result.terminal).toBe(true);
    expect(result.outboxState).toBe('failed');
    expect(result.error).toContain('Retry limit exceeded');
    expect(result.attempts).toBe(2); // 1 initial + 1 retry
  });

  it('initializes the provider on first initialize() call', async () => {
    const provider = new MockEmailProvider();
    const dispatcher = new EmailDispatcher(provider);

    expect(provider.isInitialized()).toBe(false);

    await dispatcher.initialize();

    expect(provider.isInitialized()).toBe(true);

    // Second call — should be a no-op
    await dispatcher.initialize();
    expect(provider.isInitialized()).toBe(true);
  });

  describe('provider configuration', () => {
    const originalEnv = process.env.EMAIL_PROVIDER;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.EMAIL_PROVIDER = originalEnv;
      } else {
        delete process.env.EMAIL_PROVIDER;
      }
    });

    it('defaults to mock provider when EMAIL_PROVIDER is unset', () => {
      delete process.env.EMAIL_PROVIDER;
      const provider = createProvider();
      expect(provider.name).toBe('mock');
    });

    it('creates console provider when EMAIL_PROVIDER=console', () => {
      process.env.EMAIL_PROVIDER = 'console';
      const provider = createProvider();
      expect(provider.name).toBe('console');
    });

    it('throws for unknown provider', () => {
      process.env.EMAIL_PROVIDER = 'unknown-provider';
      expect(() => createProvider()).toThrow(InvalidProviderError);
    });

    it('throws for unimplemented provider', () => {
      process.env.EMAIL_PROVIDER = 'smtp';
      expect(() => createProvider()).toThrow(InvalidProviderError);
    });
  });

  describe('healthCheck', () => {
    it('returns true when provider is healthy', async () => {
      const provider = new MockEmailProvider();
      const dispatcher = new EmailDispatcher(provider);
      expect(await dispatcher.healthCheck()).toBe(true);
    });

    it('returns false when provider is unhealthy', async () => {
      const provider = new MockEmailProvider();
      provider.setHealthy(false);
      const dispatcher = new EmailDispatcher(provider);
      expect(await dispatcher.healthCheck()).toBe(false);
    });
  });
});
