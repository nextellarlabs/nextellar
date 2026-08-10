/**
 * Outbox — Lightweight outbox-style delivery guarantees
 *
 * Before a message is dispatched, it enters the outbox in a "pending" state.
 * The dispatcher transitions it through sending → delivered (or failed).
 *
 * State machine (deterministic):
 *
 *   Pending ──► Sending ──► Delivered
 *      │            │
 *      └────────────┼──► Failed
 *                   │
 *                   └──► Pending  (reset for retry)
 *   Failed ──► Pending  (reset for retry)
 *
 * Design guarantees:
 * - No duplicate successful sends (delivered messages cannot transition)
 * - Only pending / failed messages can be retried
 * - State transitions are validated at runtime
 */

import type { EmailMessage } from './providers/provider.js';

// --- Types ---

/** Possible states of an outbox entry */
export type OutboxState = 'pending' | 'sending' | 'delivered' | 'failed';

/** An entry in the outbox, wrapping a message with delivery metadata */
export interface OutboxEntry {
  message: EmailMessage;
  state: OutboxState;
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

/** State transition map — which transitions are valid */
const VALID_TRANSITIONS: Record<OutboxState, OutboxState[]> = {
  pending: ['sending', 'pending'], // pending → pending is a no-op reset
  sending: ['delivered', 'failed', 'pending'], // pending = reset for retry
  delivered: [], // terminal — no further transitions
  failed: ['pending'], // can be reset for retry
};

// --- In-memory store ---

const store = new Map<string, OutboxEntry>();

// --- Public API ---

/**
 * Add a message to the outbox in "pending" state.
 * Returns true if the message was added, false if it already exists.
 */
export function addToOutbox(message: EmailMessage): boolean {
  if (store.has(message.id)) {
    return false;
  }

  store.set(message.id, {
    message,
    state: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: new Date(),
  });

  return true;
}

/**
 * Transition a message to a new state.
 *
 * @param id     Message identifier
 * @param state  Target state
 * @param error  Error string (used when transitioning to "failed")
 * @returns true if the transition succeeded
 * @throws Error on invalid state transitions
 */
export function transitionOutbox(
  id: string,
  state: OutboxState,
  error?: string
): boolean {
  const entry = store.get(id);
  if (!entry) {
    throw new Error(`Outbox: message "${id}" not found`);
  }

  const allowed = VALID_TRANSITIONS[entry.state];
  if (!allowed.includes(state)) {
    throw new Error(
      `Outbox: invalid transition "${entry.state}" → "${state}" for message "${id}". ` +
        `Allowed: ${allowed.join(', ')}`
    );
  }

  entry.state = state;
  entry.lastAttemptAt = new Date();

  if (state === 'sending') {
    entry.attempts += 1;
  }

  if (error !== undefined) {
    entry.lastError = error;
  }

  return true;
}

/**
 * Mark a message as "sending". Only valid from "pending" or "failed".
 */
export function markSending(id: string): boolean {
  return transitionOutbox(id, 'sending');
}

/**
 * Mark a message as "delivered". Only valid from "sending".
 */
export function markDelivered(id: string): boolean {
  return transitionOutbox(id, 'delivered');
}

/**
 * Mark a message as "failed". Only valid from "sending".
 */
export function markFailed(id: string, error?: string): boolean {
  return transitionOutbox(id, 'failed', error);
}

/**
 * Reset a message back to "pending" for retry.
 * Valid from "sending" or "failed".
 */
export function resetForRetry(id: string): boolean {
  const entry = store.get(id);
  if (!entry) {
    throw new Error(`Outbox: message "${id}" not found`);
  }

  // Only allow reset from states that support returning to pending
  const allowed = VALID_TRANSITIONS[entry.state];
  if (!allowed.includes('pending')) {
    throw new Error(
      `Outbox: cannot reset "${id}" from terminal state "${entry.state}"`
    );
  }

  entry.state = 'pending';
  entry.lastError = null;
  return true;
}

/**
 * Get an outbox entry by id.
 */
export function getOutboxEntry(id: string): OutboxEntry | undefined {
  return store.get(id);
}

/**
 * Get all messages in a specific state.
 */
export function getOutboxEntriesByState(state: OutboxState): OutboxEntry[] {
  return Array.from(store.values()).filter((e) => e.state === state);
}

/**
 * Check if a message has already been delivered (duplicate prevention).
 */
export function isDelivered(id: string): boolean {
  const entry = store.get(id);
  return entry?.state === 'delivered';
}

/**
 * Remove an entry from the outbox (for cleanup/testing).
 */
export function removeFromOutbox(id: string): boolean {
  return store.delete(id);
}

/**
 * Clear the entire outbox (for testing).
 */
export function clearOutbox(): void {
  store.clear();
}

/**
 * Get the total number of entries in the outbox.
 */
export function getOutboxSize(): number {
  return store.size;
}

/**
 * Get a snapshot of all entries (for debugging/testing).
 */
export function getAllOutboxEntries(): readonly OutboxEntry[] {
  return Array.from(store.values());
}
