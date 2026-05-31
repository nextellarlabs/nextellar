import { randomBytes } from 'crypto';

export type OutboxEventState = 'pending' | 'delivered' | 'failed';

export interface OutboxEvent {
  id: string;
  url: string;
  payload: unknown;
  state: OutboxEventState;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
  error: string | null;
}

const MAX_ATTEMPTS = 5;

const outboxStore = new Map<string, OutboxEvent>();

export function writeEvent(url: string, payload: unknown): OutboxEvent {
  const event: OutboxEvent = {
    id: randomBytes(16).toString('hex'),
    url,
    payload,
    state: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    lastAttemptAt: null,
    error: null,
  };
  outboxStore.set(event.id, event);
  return event;
}

export function getEvent(id: string): OutboxEvent | undefined {
  return outboxStore.get(id);
}

export function getPendingEvents(): OutboxEvent[] {
  return Array.from(outboxStore.values()).filter((e) => e.state === 'pending');
}

export function getAllEvents(): OutboxEvent[] {
  return Array.from(outboxStore.values());
}

export function clearOutbox(): void {
  outboxStore.clear();
}

export const outboxDeps = {
  async deliverWebhook(_url: string, _payload: unknown): Promise<void> {},
};

async function attemptDelivery(event: OutboxEvent): Promise<void> {
  event.attempts += 1;
  event.lastAttemptAt = Date.now();

  try {
    await outboxDeps.deliverWebhook(event.url, event.payload);
    event.state = 'delivered';
    event.error = null;
  } catch (err) {
    event.error = err instanceof Error ? err.message : String(err);
    if (event.attempts >= MAX_ATTEMPTS) {
      event.state = 'failed';
    }
  }
}

export async function relayPendingEvents(): Promise<{
  delivered: number;
  failed: number;
  retrying: number;
}> {
  const pending = getPendingEvents();
  let delivered = 0;
  let failed = 0;
  let retrying = 0;

  for (const event of pending) {
    await attemptDelivery(event);
    if (event.state === 'delivered') delivered += 1;
    else if (event.state === 'failed') failed += 1;
    else retrying += 1;
  }

  return { delivered, failed, retrying };
}
