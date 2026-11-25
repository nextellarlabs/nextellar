'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export interface UseBumpSequenceOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

export interface BumpSequenceParams {
  publicKey: string;
  targetSequence: string | number | bigint;
  secret: string;
}

export interface BumpSequenceResult {
  success: boolean;
  newSequence?: string;
  hash?: string;
  raw?: unknown;
  error?: string;
}

export interface BumpSequenceState {
  bumpSequence: (params: BumpSequenceParams) => Promise<BumpSequenceResult>;
  loading: boolean;
  error: Error | null;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

export function useBumpSequence(
  options: UseBumpSequenceOptions = {}
): BumpSequenceState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
  } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');

  useEffect(() => {
    if (lastHorizonUrlRef.current !== horizonUrl) {
      try {
        serverRef.current = new Horizon.Server(horizonUrl);
        lastHorizonUrlRef.current = horizonUrl;
      } catch (err) {
        console.error('Failed to initialize Horizon server:', err);
        setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
      }
    }
  }, [horizonUrl]);

  const getNetworkPassphrase = useCallback((): string => {
    return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  }, [network]);

  const bumpSequence = useCallback(async ({
    publicKey,
    targetSequence,
    secret,
  }: BumpSequenceParams): Promise<BumpSequenceResult> => {
    setLoading(true);
    setError(null);

    try {
      if (!serverRef.current) {
        throw new Error('Horizon server not initialized');
      }
      if (!publicKey || publicKey.length !== 56 || !publicKey.startsWith('G')) {
        throw new Error('Invalid public key format');
      }
      if (!secret || secret.length !== 56 || !secret.startsWith('S')) {
        throw new Error('Invalid secret key format');
      }

      let target: bigint;
      try {
        target = BigInt(targetSequence);
      } catch {
        throw new Error('Invalid target sequence');
      }
      if (target <= 0n) {
        throw new Error('Target sequence must be a positive integer');
      }

      const keypair = Keypair.fromSecret(secret);
      if (keypair.publicKey() !== publicKey) {
        throw new Error('Secret key does not match the provided public key');
      }

      const account = await serverRef.current.loadAccount(publicKey);
      const current = BigInt(account.sequenceNumber());
      if (target <= current) {
        throw new Error('Target sequence must be greater than current sequence');
      }

      const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      });
      builder.addOperation(Operation.bumpSequence({ bumpTo: target.toString() }));
      builder.setTimeout(30);

      const transaction = builder.build();
      transaction.sign(keypair);
      const result = await serverRef.current.submitTransaction(transaction);

      return {
        success: true,
        newSequence: target.toString(),
        hash: result.hash,
        raw: result,
      };
    } catch (err: unknown) {
      const errorObj = err as {
        message?: string;
        response?: {
          status?: number;
          data?: {
            extras?: { result_codes?: { transaction?: string; operations?: string[] } };
          };
        };
      };
      let message = errorObj?.message || 'Failed to bump account sequence';
      if (errorObj?.response?.data?.extras?.result_codes) {
        const codes = errorObj.response.data.extras.result_codes;
        message = `Transaction failed - ${codes.transaction || codes.operations?.join(', ') || 'Unknown error'}`;
      } else if (errorObj?.response?.status === 400) {
        message = 'Invalid transaction format or content';
      } else if (errorObj?.response?.status && errorObj.response.status >= 500) {
        message = 'Horizon server error during submission';
      }

      const submissionError = new Error(message);
      setError(submissionError);
      console.error('Bump sequence failed:', err);
      return {
        success: false,
        error: message,
        raw: errorObj?.response?.data,
      };
    } finally {
      setLoading(false);
    }
  }, [getNetworkPassphrase]);

  return { bumpSequence, loading, error };
}
