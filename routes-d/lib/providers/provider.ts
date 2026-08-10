/**
 * Email Provider Interface & Types
 *
 * Defines the abstraction that all email providers must implement.
 * The dispatcher depends only on this interface, never on concrete providers.
 */

/** A unique identifier for a message within the dispatcher */
export type MessageId = string;

/** Structured attachment */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  encoding?: 'base64' | 'utf-8';
}

/** The canonical email message shape consumed by all providers */
export interface EmailMessage {
  id: MessageId;
  to: string | string[];
  from: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/** Result returned by every provider after a send attempt */
export interface SendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  providerResponse?: unknown;
  error?: string;
  attemptNumber: number;
}

/** The interface every email transport provider must satisfy */
export interface EmailProvider {
  /** Unique name of the provider (used for logging / env configuration) */
  readonly name: string;

  /**
   * Send a single email message.
   * Implementations should throw only on infrastructure-level failures;
   * recoverable / provider-level errors should be returned in SendResult.
   */
  send(message: EmailMessage): Promise<SendResult>;

  /**
   * Optional one-time setup called before the first send.
   * Use for connection pool creation, auth handshakes, etc.
   */
  initialize?(): Promise<void>;

  /**
   * Optional health-check that the dispatcher can call periodically.
   * Should return `true` when the provider is reachable & configured.
   */
  healthCheck?(): Promise<boolean>;
}
