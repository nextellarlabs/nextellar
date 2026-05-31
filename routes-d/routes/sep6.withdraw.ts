import { Request, Response } from 'express';
import { validateKycStatus, generateTransactionId } from '../lib/sep6.js';

export const withdraw = async (req: Request, res: Response) => {
  try {
    const { asset_code, amount, dest, dest_extra, account, user_id } = req.body;

    if (!asset_code || !amount || !dest) {
      return res.status(400).json({
        error: 'Missing required fields: asset_code, amount, dest'
      });
    }

    const kyc = await validateKycStatus(user_id || account);
    if (!kyc.approved) {
      return res.status(403).json({
        error: 'KYC required',
        status: 'pending_customer_info_update'
      });
    }

    const txId = generateTransactionId();

    res.json({
      success: true,
      id: txId,
      status: 'pending_user_transfer_start',
      type: 'withdrawal',
      asset_code,
      amount,
      dest,
      instructions: {
        withdraw_anchor_account: account,
        memo_type: 'text',
        memo: txId,
        message: `Withdraw ${amount} ${asset_code} to ${dest}`
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};