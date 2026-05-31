// Unit tests for payment retry queue (Issue #288).

import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import {
  createPaymentQueue,
  getPaymentStatus,
  type PaymentQueue,
  type PaymentQueueEntry,
} from '../lib/paymentQueue.js';

describe('Payment Queue', () => {
  let queue: PaymentQueue;

  beforeEach(() => {
    queue = createPaymentQueue({
      initialBackoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 1000,
      defaultMaxAttempts: 3,
    });
  });

  describe('enqueue', () => {
    it('enqueues a payment', () => {
      const result = queue.enqueue('payment-1', { amount: '100' });
      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('is idempotent against duplicate enqueues', () => {
      const result1 = queue.enqueue('payment-1', { amount: '100' });
      const result2 = queue.enqueue('payment-1', { amount: '100' });

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(queue.size()).toBe(1);
    });

    it('prevents re-enqueue of dead-lettered payments', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      const entry = queue.dequeue();
      queue.markFailure('payment-1', 'error');

      const result = queue.enqueue('payment-1', { amount: '100' });
      expect(result).toBe(false);
      expect(queue.deadLetterSize()).toBe(1);
    });
  });

  describe('dequeue', () => {
    it('returns undefined when queue is empty', () => {
      expect(queue.dequeue()).toBeUndefined();
    });

    it('returns entry ready for retry', () => {
      queue.enqueue('payment-1', { amount: '100' });
      const entry = queue.dequeue();

      expect(entry).toBeDefined();
      expect(entry?.paymentId).toBe('payment-1');
      expect(entry?.attempts).toBe(0);
    });

    it('does not return entries not yet ready', () => {
      vi.useFakeTimers();
      queue.enqueue('payment-1', { amount: '100' });

      // Mark as failed to schedule next retry
      const entry = queue.dequeue();
      queue.markFailure('payment-1', 'error');

      // Advance 50ms (less than initial backoff of 100ms)
      vi.advanceTimersByTime(50);
      expect(queue.dequeue()).toBeUndefined();

      // Advance to 100ms total
      vi.advanceTimersByTime(50);
      expect(queue.dequeue()).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('markSuccess', () => {
    it('removes payment from queue', () => {
      queue.enqueue('payment-1', { amount: '100' });
      expect(queue.size()).toBe(1);

      queue.markSuccess('payment-1');
      expect(queue.size()).toBe(0);
    });

    it('removes payment from dead letters', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      queue.dequeue();
      queue.markFailure('payment-1', 'error');

      expect(queue.deadLetterSize()).toBe(1);
      queue.markSuccess('payment-1');
      expect(queue.deadLetterSize()).toBe(0);
    });
  });

  describe('markFailure', () => {
    it('schedules next retry with exponential backoff', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      queue.enqueue('payment-1', { amount: '100' });
      const entry1 = queue.dequeue();
      queue.markFailure('payment-1', 'error 1');

      // First retry: 100ms backoff
      const entry2 = queue.dequeue();
      expect(entry2).toBeUndefined();
      vi.advanceTimersByTime(100);
      expect(queue.dequeue()).toBeDefined();

      // Second retry: 200ms backoff
      queue.markFailure('payment-1', 'error 2');
      vi.advanceTimersByTime(200);
      expect(queue.dequeue()).toBeDefined();

      vi.useRealTimers();
    });

    it('moves to dead letter after max attempts', () => {
      queue.enqueue('payment-1', { amount: '100' }, 2);

      // First attempt
      queue.dequeue();
      queue.markFailure('payment-1', 'error 1');
      expect(queue.size()).toBe(1);
      expect(queue.deadLetterSize()).toBe(0);

      // Second attempt (max reached)
      queue.dequeue();
      queue.markFailure('payment-1', 'error 2');
      expect(queue.size()).toBe(0);
      expect(queue.deadLetterSize()).toBe(1);
    });

    it('records final error in dead letter', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      queue.dequeue();
      queue.markFailure('payment-1', 'final error');

      const deadLetters = queue.getDeadLetters();
      expect(deadLetters).toHaveLength(1);
      expect(deadLetters[0].finalError).toBe('final error');
      expect(deadLetters[0].attempts).toBe(1);
    });
  });

  describe('getDeadLetters', () => {
    it('returns empty array when no dead letters', () => {
      expect(queue.getDeadLetters()).toEqual([]);
    });

    it('returns all dead-lettered payments', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      queue.dequeue();
      queue.markFailure('payment-1', 'error 1');

      queue.enqueue('payment-2', { amount: '200' }, 1);
      queue.dequeue();
      queue.markFailure('payment-2', 'error 2');

      const deadLetters = queue.getDeadLetters();
      expect(deadLetters).toHaveLength(2);
      expect(deadLetters.map((dl: { paymentId: string }) => dl.paymentId)).toEqual(['payment-1', 'payment-2']);
    });
  });

  describe('clear', () => {
    it('clears queue and dead letters', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      queue.dequeue();
      queue.markFailure('payment-1', 'error');

      expect(queue.size()).toBe(0);
      expect(queue.deadLetterSize()).toBe(1);

      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.deadLetterSize()).toBe(0);
    });
  });

  describe('getPaymentStatus', () => {
    it('returns dead letter status', () => {
      queue.enqueue('payment-1', { amount: '100' }, 1);
      queue.dequeue();
      queue.markFailure('payment-1', 'error');

      const status = getPaymentStatus(queue, 'payment-1');
      expect(status).toEqual({
        inQueue: false,
        inDeadLetter: true,
        attempts: 1,
      });
    });

    it('returns undefined for unknown payments', () => {
      const status = getPaymentStatus(queue, 'unknown');
      expect(status).toBeUndefined();
    });
  });

  describe('maxBackoff capping', () => {
    it('caps backoff at maxBackoffMs', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      queue.enqueue('payment-1', { amount: '100' }, 10);

      // Fail multiple times to reach max backoff
      for (let i = 0; i < 5; i++) {
        queue.dequeue();
        queue.markFailure('payment-1', `error ${i}`);
        vi.advanceTimersByTime(1000); // Advance by max backoff
      }

      // Should still be in queue (not dead-lettered yet)
      expect(queue.size()).toBe(1);
      expect(queue.deadLetterSize()).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('custom maxAttempts', () => {
    it('respects custom maxAttempts per payment', () => {
      queue.enqueue('payment-1', { amount: '100' }, 5);
      queue.enqueue('payment-2', { amount: '200' }, 2);

      // Fail payment-1 four times
      for (let i = 0; i < 4; i++) {
        queue.dequeue();
        queue.markFailure('payment-1', 'error');
      }
      expect(queue.size()).toBe(1); // Still in queue

      // Fail payment-2 once
      queue.dequeue();
      queue.markFailure('payment-2', 'error');
      expect(queue.size()).toBe(1); // payment-1 still in queue

      // Fail payment-2 again (reaches max)
      queue.dequeue();
      queue.markFailure('payment-2', 'error');
      expect(queue.deadLetterSize()).toBe(1); // payment-2 dead-lettered
    });
  });
});
