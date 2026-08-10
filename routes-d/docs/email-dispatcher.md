# Email Notification Dispatcher

## Overview

The `routes-d` email notification dispatcher is a pluggable, transactional email system with outbox-style delivery guarantees. It validates messages, delegates to a configured provider, and ensures reliable delivery through automatic retries and an outbox.

## Architecture

```
┌────────────────┐     ┌───────────────┐     ┌──────────────┐
│  EmailMessage  │────▶│  Dispatcher   │────▶│   Outbox     │
│  (validated)   │     │  (orchestr.)  │     │  (state)     │
└────────────────┘     └───────┬───────┘     └──────┬───────┘
                               │                    │
                               ▼                    ▼
                        ┌──────────────┐     ┌──────────────┐
                        │   Provider   │     │    Retry     │
                        │  (transport) │     │   Engine     │
                        └──────────────┘     └──────────────┘
```

## Components

### `lib/emailDispatcher.ts`

Main orchestrator. Responsibilities:

- **Validation** — Ensures messages have required fields (`to`, `from`, `subject`, body) with valid email formats.
- **Outbox tracking** — Every send enters the outbox before dispatch.
- **Provider delegation** — Forwards to the configured `EmailProvider`.
- **Retry integration** — Uses the retry engine for transient failures.
- **Structured results** — Returns `DispatchResult` with full audit info.

### `lib/providers/provider.ts`

Defines the `EmailProvider` interface and shared types:

| Export | Description |
|--------|-------------|
| `EmailMessage` | Canonical message shape (to, from, subject, body, cc, bcc, attachments) |
| `SendResult` | Per-attempt result from a provider (success, messageId, error, attemptNumber) |
| `EmailProvider` | Interface: `send()`, optional `initialize()`, optional `healthCheck()` |

### `lib/providers/factory.ts`

Loads the provider from `EMAIL_PROVIDER` environment variable.

| Provider | Description |
|----------|-------------|
| `mock` | In-memory provider for testing (default when unset) |
| `console` | Logs to stdout, always succeeds — useful for dev/CI |
| `smtp` | Placeholder for SMTP integration |
| `sendgrid` | Placeholder for SendGrid integration |

Throws `InvalidProviderError` for unknown or unimplemented providers.

### `lib/providers/mock.ts`

In-memory mock provider with:

- Configurable artificial latency (`latencyMs`)
- Configurable failure simulation (`failAfter`)
- Full send record tracking
- Test helpers: `setHealthy()`, `reset()`, `getRecords()`

### `lib/retry.ts`

Generic retry engine with:

- **Exponential backoff** — `baseDelay * 2^attempt` with configurable cap
- **Jitter** — Random factor to prevent thundering herd
- **Retryable vs terminal** — `RetryableError` (transient) vs `TerminalError` (permanent)

#### Retry Flow

```
  attempt N
     │
     ▼
  fn() ──success──▶ return result
     │
     ▼
  error? ──terminal──▶ throw TerminalError
     │
     ▼
  retries left? ──no──▶ throw RetryLimitExceededError
     │
     ▼
  wait (exponential backoff + jitter)
     │
     ▼
  attempt N+1
```

### `lib/outbox.ts`

Lightweight in-memory outbox with deterministic state machine.

#### State Lifecycle

```
  Pending ──► Sending ──► Delivered  (terminal)
     │            │
     └────────────┼──► Failed
                  │
                  └──► Pending  (reset for retry)
  Failed ──► Pending  (reset for retry)
```

- **Pending** — Message added, awaiting dispatch
- **Sending** — Dispatch in progress
- **Delivered** — Terminal success state; no further transitions allowed
- **Failed** — Terminal failure state; can be reset to pending for retry

#### Guarantees

- No duplicate successful sends (delivered is a terminal state)
- State transitions are validated at runtime
- Only pending/failed messages are retryable

## Retry Flow

1. Dispatcher validates message and adds to outbox (pending)
2. Outbox transitions to sending
3. Provider.send() is called with retry engine
4. On success → outbox transitions to delivered
5. On transient failure → retry with exponential backoff
6. On terminal failure → outbox transitions to failed
7. After max retries → outbox transitions to failed, result is terminal

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `mock` | Which provider to use: `mock`, `console` |

## Usage

### Basic Usage

```typescript
import { EmailDispatcher } from './lib/emailDispatcher.js';

const dispatcher = new EmailDispatcher();

const result = await dispatcher.send({
  id: 'unique-message-id',
  to: 'user@example.com',
  from: 'noreply@nextellar.dev',
  subject: 'Welcome!',
  textBody: 'Thanks for signing up.',
  htmlBody: '<p>Thanks for signing up.</p>',
});

if (result.success) {
  console.log(`Delivered: ${result.messageId}`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### Using a Specific Provider (for testing)

```typescript
import { EmailDispatcher } from './lib/emailDispatcher.js';
import { MockEmailProvider } from './lib/providers/mock.js';

const provider = new MockEmailProvider({ failAfter: 3 });
const dispatcher = new EmailDispatcher(provider);
```

### Custom Retry Configuration

```typescript
const dispatcher = new EmailDispatcher({
  maxRetries: 5,
  baseDelayMs: 200,
  maxDelayMs: 60000,
});
```

### Error Handling

```typescript
const result = await dispatcher.send(message);

if (!result.success) {
  if (result.terminal) {
    // Permanent failure — don't retry
    console.error(`Terminal failure: ${result.error}`);
  } else {
    // Transient failure — can retry
    console.warn(`Transient failure: ${result.error}`);
  }
}
```

## Extension Guide: Adding a New Provider

To add a new provider (e.g., SendGrid):

1. Create `routes-d/lib/providers/sendgrid.ts`:

```typescript
import type { EmailProvider, EmailMessage, SendResult } from './provider.js';

export class SendGridProvider implements EmailProvider {
  readonly name = 'sendgrid';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async initialize(): Promise<void> {
    // Validate API key, warm connections
  }

  async send(message: EmailMessage): Promise<SendResult> {
    // Call SendGrid API
  }

  async healthCheck(): Promise<boolean> {
    // Ping SendGrid
  }
}
```

2. Register it in `routes-d/lib/providers/factory.ts`:

```typescript
case 'sendgrid':
  return new SendGridProvider(process.env.SENDGRID_API_KEY || '');
```

3. Add environment variable documentation above.

## Testing

```bash
# Run email dispatcher tests
npm test -- routes-d/tests/emailDispatcher

# Run all routes-d tests
npm test -- routes-d/tests
```

## Logging

The dispatcher logs only safe, non-sensitive fields:

- `provider` — Which provider handled the send
- `messageId` — The unique message identifier
- `attempts` — Number of dispatch attempts
- `durationMs` — Total dispatch duration
- `success` — Whether delivery succeeded

The following are **never** logged:

- Email body (text or HTML)
- Email subject
- Recipient addresses
- API keys, secrets, tokens, credentials
- Attachment content
