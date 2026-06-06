// GET /payments/status — surface retry state for a payment (Issue #288).
//
// Returns the current status of a payment in the retry queue, including
// attempt count, next retry time, and dead-letter status.

import { Router, type Request, type Response } from 'express';
import type { PaymentQueue } from '../lib/paymentQueue.js';

export interface PaymentsStatusRouterOptions {
  /** The payment queue instance (required) */
  queue: PaymentQueue;
}

export function createPaymentsStatusRouter(
  options: PaymentsStatusRouterOptions,
): Router {
  const router = Router();
  const { queue } = options;

  router.get('/:paymentId', (req: Request, res: Response) => {
    const { paymentId } = req.params;

    if (!paymentId || typeof paymentId !== 'string' || paymentId.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'paymentId is required',
      });
    }

    // Check dead letters
    const deadLetters = queue.getDeadLetters();
    const deadLetter = deadLetters.find((dl) => dl.paymentId === paymentId);

    if (deadLetter) {
      return res.status(200).json({
        ok: true,
        status: 'dead_letter',
        paymentId,
        attempts: deadLetter.attempts,
        maxAttempts: deadLetter.maxAttempts,
        finalError: deadLetter.finalError,
        failedAt: deadLetter.failedAt,
      });
    }

    // Payment not found in queue or dead letters
    return res.status(404).json({
      ok: false,
      error: 'payment not found',
    });
  });

  return router;
}
