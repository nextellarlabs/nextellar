import { Request, Response } from 'express';
import { validateKycStatus, generateTransactionId } from '../lib/sep6.js';

export const deposit = async (req: Request, res: Response) => {
  try {
    const { asset_code, amount, account, memo_type, memo, user_id } = req.body;

    if (!asset_code || !amount || !account) {
      return res.status(400).json({
        error: 'Missing required fields: asset_code, amount, account'
      });
    }

    // KYC Validation
    const kyc = await validateKycStatus(user_id || account);
    if (!kyc.approved) {
      return res.status(403).json({
        error: 'KYC required',
        status: 'pending_customer_info_update',
        type: kyc.required_fields ? 'non_interactive' : 'interactive'
      });
    }

    const txId = generateTransactionId();

    res.json({
      success: true,
      id: txId,
      status: 'pending_anchor',
      type: 'deposit',
      asset_code,
      amount,
      account,
      instructions: {
        destination: account,
        memo_type: memo_type || 'text',
        memo: memo || txId,
        message: `Deposit ${amount} ${asset_code} to your Stellar account`
      },
      more_info_url: `https://nextellar.dev/tx/${txId}`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};