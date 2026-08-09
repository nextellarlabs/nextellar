/**
 * Email Notification Dispatcher
 *
 * Pluggable transactional email dispatcher that:
 * - Validates incoming email requests
 * - Delegates delivery to a configured EmailProvider
 * - Tracks every message through the outbox for reliability
 * - Retries transient failures with exponential backoff
 * - Returns structured results with full auditability
 *
 * Architecture:
 *
 *   send() → validate → outbox(pending) → outbox(sending)
 *          → provider.send() [with retry]
 *          → outbox(delivered) or outbox(failed)
 *          → structured result
 */

import type { EmailMessage, EmailProvider } from './providers/provider.js';
import { addToOutbox, markSending, markDelivered, markFailed, getOutboxEntry } from './outbox.js';
import { withRetry, RetryableError, TerminalError, RetryLimitExceededError } from './retry.js';
import { createProvider } from './providers/factory.js';

// --- Structured errors ---

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// --- Dispatcher result ---

/** Rich result returned by the dispatcher after every send */
export interface DispatchResult {
  success: boolean;
  messageId: string;
  provider: string;
  attempts: number;
  outboxState: string;
  providerResponse?: unknown;
  error?: string;
  terminal: boolean;
  durationMs: number;
}

// --- Dispatcher configuration ---

export interface DispatcherConfig {
  /** Number of retry attempts for transient failures (default 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default 100) */
  baseDelayMs?: number;
  /** Maximum retry delay in ms (default 30000) */
  maxDelayMs?: number;
  /** Whether to require both textBody and htmlBody (default false) */
  requireAllBodies?: boolean;
}

const DEFAULT_CONFIG: Required<DispatcherConfig> = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  requireAllBodies: false,
};

// --- Dispatcher class ---

export class EmailDispatcher {
  private readonly provider: EmailProvider;
  private readonly config: Required<DispatcherConfig>;
  private initialized = false;

  /**
   * Create a new dispatcher.
   *
   * @param providerOrConfig  Either an EmailProvider instance (for testing)
   *                          or a DispatcherConfig (uses env-configured provider).
   *                          Omit both to use env-configured provider with defaults.
   */
  constructor(providerOrConfig?: EmailProvider | DispatcherConfig, configOverride?: DispatcherConfig) {
    if (providerOrConfig && 'name' in providerOrConfig) {
      this.provider = providerOrConfig as EmailProvider;
      this.config = { ...DEFAULT_CONFIG, ...(configOverride || {}) };
    } else {
      this.provider = createProvider();
      this.config = { ...DEFAULT_CONFIG, ...(providerOrConfig as DispatcherConfig || {}), ...(configOverride || {}) };
    }
  }

  /**
   * Initialize the underlying provider (e.g., establish connections).
   * Safe to call multiple times — only runs once.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.provider.initialize) {
      await this.provider.initialize();
    }

    this.initialized = true;
  }

  /**
   * Check the provider's health.
   */
  async healthCheck(): Promise<boolean> {
    if (this.provider.healthCheck) {
      return this.provider.healthCheck();
    }
    return true;
  }

  /**
   * Send an email message through the configured provider.
   *
   * Flow:
   * 1. Validate the message
   * 2. Add to outbox (pending)
   * 3. Mark as sending
   * 4. Call provider with retry logic
   * 5. Mark as delivered or failed
   * 6. Return structured result
   *
   * @param message The email message to send
   * @returns A structured DispatchResult
   */
  async send(message: EmailMessage): Promise<DispatchResult> {
    const startTime = Date.now();

    // 1. Validate
    const validationError = this.validateMessage(message);
    if (validationError) {
      return {
        success: false,
        messageId: message.id,
        provider: this.provider.name,
        attempts: 0,
        outboxState: 'rejected',
        error: validationError.message,
        terminal: true,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Add to outbox
    addToOutbox(message);

    // 3. Mark as sending
    markSending(message.id);

    try {
      // 4. Send with retry — track attempts for accurate reporting
      let attemptCount = 0;
      const result = await withRetry(
        () => {
          attemptCount++;
          return this.provider.send(message);
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelayMs: this.config.baseDelayMs,
          maxDelayMs: this.config.maxDelayMs,
          isRetryable: isProviderErrorRetryable,
        }
      );

      // 5. Mark delivery state
      if (result.success) {
        markDelivered(message.id);
      } else {
        markFailed(message.id, result.error);
      }

      this.logSend(message.id, attemptCount, result.success);

      return {
        success: result.success,
        messageId: message.id,
        provider: result.provider,
        attempts: attemptCount,
        outboxState: result.success ? 'delivered' : 'failed',
        providerResponse: result.providerResponse,
        error: result.error,
        terminal: !result.success,
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      // Determine if terminal
      const terminal =
        error instanceof TerminalError ||
        error instanceof RetryLimitExceededError;

      const attempts =
        error instanceof RetryLimitExceededError
          ? error.attempts
          : 1;

      const errorMessage = extractErrorMessage(error);

      // 5. Mark as failed
      markFailed(message.id, errorMessage);

      this.logSend(message.id, attempts, false);

      return {
        success: false,
        messageId: message.id,
        provider: this.provider.name,
        attempts,
        outboxState: 'failed',
        providerResponse: undefined,
        error: errorMessage,
        terminal,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate an email message before sending.
   * Returns null if valid, or a ValidationError if not.
   */
  private validateMessage(message: EmailMessage): ValidationError | null {
    if (!message.to) {
      return new ValidationError('"to" is required', 'to');
    }

    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (recipients.length === 0) {
      return new ValidationError('"to" must contain at least one recipient', 'to');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const recipient of recipients) {
      if (!emailRegex.test(recipient)) {
        return new ValidationError(`Invalid email address: "${recipient}"`, 'to');
      }
    }

    if (!message.from || !emailRegex.test(message.from)) {
      return new ValidationError('"from" must be a valid email address', 'from');
    }

    if (!message.subject || message.subject.trim().length === 0) {
      return new ValidationError('"subject" is required', 'subject');
    }

    if (this.config.requireAllBodies) {
      if (!message.textBody) {
        return new ValidationError('"textBody" is required', 'textBody');
      }
      if (!message.htmlBody) {
        return new ValidationError('"htmlBody" is required', 'htmlBody');
      }
    } else {
      if (!message.textBody && !message.htmlBody) {
        return new ValidationError(
          'At least one of "textBody" or "htmlBody" is required',
          'body'
        );
      }
    }

    // Validate CC recipients if present
    if (message.cc) {
      const ccList = Array.isArray(message.cc) ? message.cc : [message.cc];
      for (const cc of ccList) {
        if (!emailRegex.test(cc)) {
          return new ValidationError(`Invalid CC email: "${cc}"`, 'cc');
        }
      }
    }

    // Validate BCC recipients if present
    if (message.bcc) {
      const bccList = Array.isArray(message.bcc) ? message.bcc : [message.bcc];
      for (const bcc of bccList) {
        if (!emailRegex.test(bcc)) {
          return new ValidationError(`Invalid BCC email: "${bcc}"`, 'bcc');
        }
      }
    }

    return null;
  }

  /**
   * Structured logging — only logs safe fields, never email body or secrets.
   */
  private logSend(messageId: string, attempts: number, success: boolean): void {
    const entry = getOutboxEntry(messageId);
    const durationMs = entry
      ? Date.now() - entry.createdAt.getTime()
      : 0;

    const msg = `[email-dispatcher] provider=${this.provider.name} messageId=${messageId} ` +
        `attempts=${attempts} success=${success} durationMs=${durationMs}`;

    if (success) {
      console.log(msg);
    } else {
      console.error(msg);
    }
  }
}

// --- Helpers ---

/**
 * Determine if a provider error is retryable.
 * Default behavior:
 * - Connection/timeout/network errors → retry
 * - Invalid recipient / auth errors → terminal
 */
function isProviderErrorRetryable(error: unknown): boolean {
  if (error instanceof TerminalError) return false;
  if (error instanceof RetryableError) return true;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Terminal patterns — permanent failures
    if (
      message.includes('invalid recipient') ||
      message.includes('authentication failed') ||
      message.includes('unauthorized') ||
      message.includes('not found') ||
      message.includes('invalid email')
    ) {
      return false;
    }

    // Retryable patterns — transient failures
    if (
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('temporarily') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('network')
    ) {
      return true;
    }
  }

  // Unknown errors → retry (conservative)
  return true;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof RetryLimitExceededError) {
    return `Retry limit exceeded after ${error.attempts} attempts: ${extractErrorMessage(error.lastError)}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
