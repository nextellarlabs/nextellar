/**
 * Provider Factory
 *
 * Loads the configured EmailProvider from environment variables.
 * The dispatcher uses this factory to obtain its provider, so it
 * never needs to know about concrete implementations.
 */

import type { EmailProvider, SendResult } from './provider.js';
import { MockEmailProvider } from './mock.js';

/** Error thrown when EMAIL_PROVIDER is invalid or missing */
export class InvalidProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProviderError';
  }
}

/**
 * Create the provider specified by process.env.EMAIL_PROVIDER.
 *
 * Falls back to "mock" when the env var is not set.
 *
 * @throws {InvalidProviderError} when EMAIL_PROVIDER names an unknown or unimplemented provider
 */
export function createProvider(): EmailProvider {
  const name = (process.env.EMAIL_PROVIDER || 'mock').toLowerCase();

  if (name === 'mock') {
    return new MockEmailProvider();
  }

  if (name === 'console') {
    return createConsoleProvider();
  }

  // smtp, sendgrid are reserved for future implementation
  if (name === 'smtp' || name === 'sendgrid') {
    throw new InvalidProviderError(
      `Provider "${name}" is not yet implemented. Available: mock, console.`
    );
  }

  throw new InvalidProviderError(
    `Unknown EMAIL_PROVIDER: "${name}". Available: mock, console.`
  );
}

/**
 * Inline console provider that logs to stdout and always succeeds.
 * Used internally by the factory — useful for development / CI.
 */
function createConsoleProvider(): EmailProvider {
  return {
    name: 'console',

    async send(message): Promise<SendResult> {
      console.log(`[console-provider] TO: ${formatRecipient(message.to)} | SUBJECT: ${message.subject}`);
      return {
        success: true,
        messageId: `console-${Date.now()}`,
        provider: 'console',
        attemptNumber: 1,
      };
    },

    async healthCheck(): Promise<boolean> {
      return true;
    },
  };
}

function formatRecipient(to: string | string[]): string {
  return Array.isArray(to) ? to.join(', ') : to;
}
