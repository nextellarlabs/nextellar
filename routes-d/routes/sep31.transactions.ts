import { Router, Request, Response, NextFunction } from 'express';
import { validateSep31Transaction } from '../lib/sep31Validator.js';
import {
  emitSettlementWebhook,
  sep31TransactionStore,
} from '../lib/sep31Store.js';

const router = Router();

/**
 * Submit a SEP-31 cross-border payment transaction.
 */
router.post(
  '/sep31/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = validateSep31Transaction(req.body);

      if (!validation.valid) {
        return res.status(422).json({
          error: 'validation_failed',
          errors: validation.errors,
        });
      }

      const transaction = sep31TransactionStore.create(validation.data);

      return res.status(201).json({
        success: true,
        data: {
          id: transaction.id,
          status: transaction.status,
          created_at: transaction.createdAt,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Query SEP-31 transaction status. Confirming a transaction emits a settlement webhook.
 */
router.get(
  '/sep31/transactions/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const transaction = sep31TransactionStore.get(id);

      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      return res.status(200).json({
        success: true,
        data: {
          id: transaction.id,
          status: transaction.status,
          amount: transaction.request.amount,
          asset_code: transaction.request.asset_code,
          destination_account: transaction.request.destination_account,
          created_at: transaction.createdAt,
          updated_at: transaction.updatedAt,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

/**
 * Confirm a SEP-31 transaction (settlement) and emit webhook.
 */
router.post(
  '/sep31/transactions/:id/confirm',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const transaction = sep31TransactionStore.get(id);

      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (transaction.status === 'completed') {
        return res.status(200).json({
          success: true,
          data: { id: transaction.id, status: transaction.status },
        });
      }

      const confirmed = sep31TransactionStore.confirm(id);
      if (confirmed) {
        await emitSettlementWebhook(confirmed);
      }

      return res.status(200).json({
        success: true,
        data: {
          id: confirmed!.id,
          status: confirmed!.status,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
