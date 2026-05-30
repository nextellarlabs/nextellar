import { Router, Request, Response, NextFunction } from 'express';
import {
  deriveMuxedAddress,
  isValidMuxId,
  matchesInboundPayment,
  MuxedAccountError,
} from '../lib/muxedAccount.js';

const router = Router();

/**
 * Return a muxed deposit address for routing inbound funds to a subaccount.
 */
router.post(
  '/stellar/deposit/address',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseAccount =
        typeof req.body?.baseAccount === 'string' ? req.body.baseAccount.trim() : '';
      const muxId =
        typeof req.body?.muxId === 'string' ? req.body.muxId.trim() : '';

      if (!baseAccount || !muxId) {
        return res.status(400).json({ error: 'baseAccount and muxId are required' });
      }

      if (!isValidMuxId(muxId)) {
        return res.status(400).json({ error: 'Invalid muxed subaccount id' });
      }

      const depositAddress = deriveMuxedAddress(baseAccount, muxId);

      return res.status(200).json({
        success: true,
        data: {
          baseAccount,
          muxId,
          depositAddress,
        },
      });
    } catch (err) {
      if (err instanceof MuxedAccountError) {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    }
  },
);

/**
 * Match an inbound payment destination to a subaccount.
 */
router.post(
  '/stellar/deposit/match',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paymentDestination =
        typeof req.body?.paymentDestination === 'string'
          ? req.body.paymentDestination.trim()
          : '';
      const baseAccount =
        typeof req.body?.baseAccount === 'string' ? req.body.baseAccount.trim() : '';
      const muxId =
        typeof req.body?.muxId === 'string' ? req.body.muxId.trim() : '';

      if (!paymentDestination || !baseAccount || !muxId) {
        return res.status(400).json({
          error: 'paymentDestination, baseAccount, and muxId are required',
        });
      }

      if (!isValidMuxId(muxId)) {
        return res.status(400).json({ error: 'Invalid muxed subaccount id' });
      }

      const matched = matchesInboundPayment(paymentDestination, baseAccount, muxId);

      return res.status(200).json({
        success: true,
        data: { matched },
      });
    } catch (err) {
      if (err instanceof MuxedAccountError) {
        return res.status(400).json({ error: err.message });
      }
      return next(err);
    }
  },
);

export default router;
