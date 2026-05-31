import { Request, Response } from 'express';
import { Server, Keypair, TransactionBuilder, Networks, Operation } from 'stellar-sdk';
import { validateMultisigOperation, buildAddSignerOperation, buildRemoveSignerOperation, buildSetThresholdsOperation } from '../lib/stellarMultisig.js';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org';

/**
 * POST /stellar/signers/add
 * Add a new signer to an account
 */
export const addSigner = async (req: Request, res: Response) => {
  try {
    const { sourceAccount, signerPublicKey, weight, memo } = req.body;

    if (!sourceAccount || !signerPublicKey || weight === undefined) {
      return res.status(400).json({ error: 'Missing required fields: sourceAccount, signerPublicKey, weight' });
    }

    const validation = validateMultisigOperation({ sourceAccount, weight });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(sourceAccount);

    const operation = buildAddSignerOperation(signerPublicKey, weight);

    let txBuilder = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    }).addOperation(operation);

    if (memo) {
      txBuilder = txBuilder.addMemo(memo);
    }

    const transaction = txBuilder.build();

    res.json({
      success: true,
      unsignedXdr: transaction.toXDR(),
      signersRequired: account.signers.length + 1,
      message: `Add signer ${signerPublicKey} with weight ${weight}`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /stellar/signers/remove
 * Remove a signer from an account
 */
export const removeSigner = async (req: Request, res: Response) => {
  try {
    const { sourceAccount, signerPublicKey } = req.body;

    if (!sourceAccount || !signerPublicKey) {
      return res.status(400).json({ error: 'Missing required fields: sourceAccount, signerPublicKey' });
    }

    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(sourceAccount);

    const operation = buildRemoveSignerOperation(signerPublicKey);

    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    }).addOperation(operation).build();

    res.json({
      success: true,
      unsignedXdr: transaction.toXDR(),
      message: `Remove signer ${signerPublicKey}`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /stellar/signers/update
 * Update thresholds and/or weights
 */
export const updateThresholds = async (req: Request, res: Response) => {
  try {
    const { sourceAccount, lowThreshold, medThreshold, highThreshold, signerWeights } = req.body;

    if (!sourceAccount) {
      return res.status(400).json({ error: 'Missing sourceAccount' });
    }

    const validation = validateMultisigOperation({ 
      sourceAccount, 
      lowThreshold, 
      medThreshold, 
      highThreshold 
    });

    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const server = new Server(HORIZON_URL);
    const account = await server.loadAccount(sourceAccount);

    const operations = buildSetThresholdsOperation(
      lowThreshold ?? account.thresholds.low_threshold,
      medThreshold ?? account.thresholds.med_threshold,
      highThreshold ?? account.thresholds.high_threshold
    );

    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.PUBLIC,
    })
      .addOperation(operations)
      .build();

    res.json({
      success: true,
      unsignedXdr: transaction.toXDR(),
      thresholds: { lowThreshold, medThreshold, highThreshold },
      message: 'Thresholds updated successfully'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};