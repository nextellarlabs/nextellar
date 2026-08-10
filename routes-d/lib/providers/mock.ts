/**
 * Mock Email Provider
 *
 * In-memory provider used for testing and local development.
 * Supports configurable failure modes and tracks all messages.
 */

import type { EmailMessage, SendResult, EmailProvider } from './provider.js';
import type { MessageId } from './provider.js';

export interface MockProviderOptions {
  /** Simulate failure after this many consecutive sends (0 = never fail) */
  failAfter?: number;
  /** Artificial latency injected before each send (ms) */
  latencyMs?: number;
}

/** Record of a message that passed through the mock provider */
export interface MockSendRecord {
  message: EmailMessage;
  result: SendResult;
  timestamp: Date;
}

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';

  private sendCount = 0;
  private records: MockSendRecord[] = [];
  private initialized = false;
  private healthy = true;
  private readonly options: Required<MockProviderOptions>;

  constructor(options: MockProviderOptions = {}) {
    this.options = {
      failAfter: options.failAfter ?? -1,
      latencyMs: options.latencyMs ?? 0,
    };
  }

  /** Simulate provider initialization */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /** Simulate health check */
  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }

  /**
   * Send an email through the mock transport.
   * Validates required fields and simulates provider behavior.
   */
  async send(message: EmailMessage): Promise<SendResult> {
    this.sendCount++;

    // Simulate latency
    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }

    // Simulate failure if configured (failAfter: number of successful sends before failing)
    // failAfter: 0 means fail on first send; negative means never fail
    if (this.options.failAfter >= 0 && this.sendCount > this.options.failAfter) {
      const result: SendResult = {
        success: false,
        provider: this.name,
        error: 'Mock provider: simulated failure',
        attemptNumber: 1,
      };
      this.records.push({ message, result, timestamp: new Date() });
      return result;
    }

    const result: SendResult = {
      success: true,
      messageId: `mock-msg-${Date.now()}-${this.sendCount}`,
      provider: this.name,
      providerResponse: { accepted: true, id: `mock-${this.sendCount}` },
      attemptNumber: 1,
    };

    this.records.push({ message, result, timestamp: new Date() });
    return result;
  }

  // --- Test helpers (not part of EmailProvider interface) ---

  /** Set the provider as unhealthy for healthCheck testing */
  setHealthy(value: boolean): void {
    this.healthy = value;
  }

  /** Check if initialize() was called */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Reset all internal state */
  reset(): void {
    this.sendCount = 0;
    this.records = [];
    this.initialized = false;
    this.healthy = true;
  }

  /** Get all send records */
  getRecords(): readonly MockSendRecord[] {
    return this.records;
  }

  /** Get the last record */
  getLastRecord(): MockSendRecord | undefined {
    return this.records[this.records.length - 1];
  }

  /** Count records for a specific message id */
  countSendsFor(messageId: MessageId): number {
    return this.records.filter((r) => r.message.id === messageId).length;
  }
}
