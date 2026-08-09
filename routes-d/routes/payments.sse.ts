import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';
import { BoundedEventBuffer } from '../lib/boundedEventBuffer.js';

const router = Router();

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PaymentStatusEvent = {
  id: string;
  paymentId: string;
  status: PaymentStatus;
  previousStatus: PaymentStatus | null;
  at: string;
};

type Payment = {
  id: string;
  userId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

/** Events retained per payment for Last-Event-ID replay (server-side). */
const PAYMENT_EVENT_HISTORY_CAPACITY = 128;

/** Pending outbound events per SSE connection when the client is slow. */
const CONNECTION_EVENT_BUFFER_CAPACITY = 32;

const DEFAULT_HEARTBEAT_MS = 15_000;

const payments = new Map<string, Payment>();
const paymentEventHistory = new Map<string, BoundedEventBuffer<PaymentStatusEvent>>();
let nextEventId = 1;

type SseSubscriber = {
  paymentId: string;
  res: Response;
  pending: BoundedEventBuffer<PaymentStatusEvent>;
  closed: boolean;
};

const subscribersByPayment = new Map<string, Set<SseSubscriber>>();

function getOrCreateHistory(paymentId: string): BoundedEventBuffer<PaymentStatusEvent> {
  let history = paymentEventHistory.get(paymentId);
  if (!history) {
    history = new BoundedEventBuffer<PaymentStatusEvent>(PAYMENT_EVENT_HISTORY_CAPACITY);
    paymentEventHistory.set(paymentId, history);
  }
  return history;
}

function formatSseMessage(event: PaymentStatusEvent): string {
  const payload = JSON.stringify({
    paymentId: event.paymentId,
    status: event.status,
    previousStatus: event.previousStatus,
    at: event.at,
  });
  return `id: ${event.id}\nevent: status\ndata: ${payload}\n\n`;
}

function parseLastEventId(header: string | undefined): number | null {
  if (!header || header.trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function eventsAfterId(
  history: BoundedEventBuffer<PaymentStatusEvent>,
  lastId: number,
): PaymentStatusEvent[] {
  return history.toArray().filter((event) => Number.parseInt(event.id, 10) > lastId);
}

function writeEventToResponse(res: Response, event: PaymentStatusEvent): boolean {
  return res.write(formatSseMessage(event));
}

function dequeuePending(subscriber: SseSubscriber): PaymentStatusEvent | undefined {
  const queue = subscriber.pending.toArray();
  if (queue.length === 0) {
    return undefined;
  }
  const [head, ...rest] = queue;
  subscriber.pending.clear();
  for (const item of rest) {
    subscriber.pending.push(item);
  }
  return head;
}

function enqueueForSubscriber(subscriber: SseSubscriber, event: PaymentStatusEvent): void {
  if (subscriber.closed) {
    return;
  }

  subscriber.pending.push(event);

  while (!subscriber.closed && subscriber.pending.size > 0) {
    const next = dequeuePending(subscriber);
    if (!next) {
      break;
    }
    const ok = writeEventToResponse(subscriber.res, next);
    if (!ok) {
      subscriber.pending.push(next);
      break;
    }
  }
}

function removeSubscriber(subscriber: SseSubscriber): void {
  subscriber.closed = true;
  const set = subscribersByPayment.get(subscriber.paymentId);
  if (set) {
    set.delete(subscriber);
    if (set.size === 0) {
      subscribersByPayment.delete(subscriber.paymentId);
    }
  }
}

function broadcastStatusEvent(event: PaymentStatusEvent): void {
  const set = subscribersByPayment.get(event.paymentId);
  if (!set) {
    return;
  }
  for (const subscriber of set) {
    enqueueForSubscriber(subscriber, event);
  }
}

function recordStatusTransition(
  payment: Payment,
  nextStatus: PaymentStatus,
): PaymentStatusEvent {
  const previousStatus = payment.status;
  const at = new Date().toISOString();
  payment.status = nextStatus;
  payment.updatedAt = at;

  const event: PaymentStatusEvent = {
    id: String(nextEventId++),
    paymentId: payment.id,
    status: nextStatus,
    previousStatus,
    at,
  };

  getOrCreateHistory(payment.id).push(event);
  broadcastStatusEvent(event);
  return event;
}

export function __resetPaymentsSse(): void {
  payments.clear();
  paymentEventHistory.clear();
  subscribersByPayment.clear();
  nextEventId = 1;
}

export function __seedPayment(payment: Payment): void {
  payments.set(payment.id, { ...payment });
  const history = getOrCreateHistory(payment.id);
  if (history.size === 0) {
    history.push({
      id: String(nextEventId++),
      paymentId: payment.id,
      status: payment.status,
      previousStatus: null,
      at: payment.updatedAt,
    });
  }
}

export function __getPayment(paymentId: string): Payment | undefined {
  const payment = payments.get(paymentId);
  return payment ? { ...payment } : undefined;
}

export function __getPaymentEventHistory(paymentId: string): PaymentStatusEvent[] {
  return getOrCreateHistory(paymentId).toArray();
}

/** Test hook: transition payment status and emit SSE to active subscribers. */
export function __transitionPaymentStatus(
  paymentId: string,
  status: PaymentStatus,
): PaymentStatusEvent | null {
  const payment = payments.get(paymentId);
  if (!payment) {
    return null;
  }
  if (payment.status === status) {
    return null;
  }
  return recordStatusTransition(payment, status);
}

export function __enqueueEventForSubscriber(
  subscriber: SseSubscriber,
  event: PaymentStatusEvent,
): void {
  enqueueForSubscriber(subscriber, event);
}

export function __createSubscriberForTest(
  paymentId: string,
  res: Response,
): SseSubscriber {
  const subscriber: SseSubscriber = {
    paymentId,
    res,
    pending: new BoundedEventBuffer<PaymentStatusEvent>(CONNECTION_EVENT_BUFFER_CAPACITY),
    closed: false,
  };
  let set = subscribersByPayment.get(paymentId);
  if (!set) {
    set = new Set();
    subscribersByPayment.set(paymentId, set);
  }
  set.add(subscriber);
  return subscriber;
}

export const __CONNECTION_EVENT_BUFFER_CAPACITY = CONNECTION_EVENT_BUFFER_CAPACITY;

/**
 * GET /payments/:paymentId/status/stream
 * Server-sent events stream for payment status transitions.
 * Supports Last-Event-ID for reconnect replay.
 */
router.get(
  '/payments/:paymentId/status/stream',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers['x-user-id'] as string | undefined;
      if (!userId) {
        sendError(res, 'UNAUTHORIZED', 'x-user-id header is required', 401);
        return;
      }

      const paymentId = req.params.paymentId?.trim();
      if (!paymentId) {
        sendError(res, 'INVALID_PAYMENT_ID', 'paymentId is required', 400);
        return;
      }

      const payment = payments.get(paymentId);
      if (!payment) {
        sendError(res, 'NOT_FOUND', 'Payment not found', 404);
        return;
      }

      if (payment.userId !== userId) {
        sendError(res, 'FORBIDDEN', 'Access denied for this payment', 403);
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const subscriber: SseSubscriber = {
        paymentId,
        res,
        pending: new BoundedEventBuffer<PaymentStatusEvent>(CONNECTION_EVENT_BUFFER_CAPACITY),
        closed: false,
      };

      let set = subscribersByPayment.get(paymentId);
      if (!set) {
        set = new Set();
        subscribersByPayment.set(paymentId, set);
      }
      set.add(subscriber);

      const lastEventId = parseLastEventId(req.headers['last-event-id'] as string | undefined);
      const history = getOrCreateHistory(paymentId);

      const replay =
        lastEventId === null
          ? history.toArray()
          : eventsAfterId(history, lastEventId);

      for (const event of replay) {
        enqueueForSubscriber(subscriber, event);
      }

      const heartbeatMs = Number.parseInt(
        String(req.query.heartbeatMs ?? DEFAULT_HEARTBEAT_MS),
        10,
      );
      const heartbeatInterval = setInterval(() => {
        if (!subscriber.closed) {
          res.write(': heartbeat\n\n');
        }
      }, Number.isFinite(heartbeatMs) && heartbeatMs > 0 ? heartbeatMs : DEFAULT_HEARTBEAT_MS);

      const onDrain = (): void => {
        if (subscriber.closed) {
          return;
        }
        while (subscriber.pending.size > 0) {
          const next = dequeuePending(subscriber);
          if (!next) {
            break;
          }
          const ok = writeEventToResponse(res, next);
          if (!ok) {
            subscriber.pending.push(next);
            break;
          }
        }
      };

      res.on('drain', onDrain);

      req.on('close', () => {
        clearInterval(heartbeatInterval);
        res.off('drain', onDrain);
        removeSubscriber(subscriber);
        if (!res.writableEnded) {
          res.end();
        }
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
