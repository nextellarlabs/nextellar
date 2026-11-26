'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Transaction,
  StrKey,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export interface UseSponsoredReservesOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
  networkPassphrase?: string;
}

export interface BuildSponsoredTxParams {
  sponsor: string;
  sponsored: string;
  operations: Operation[];
  memo?: string;
  fee?: string;
}

export interface SubmitResult {
  success: boolean;
  hash?: string;
  raw?: unknown;
  error?: string;
}

export interface SponsoredReservesState {
  loading: boolean;
  error: Error | null;
  buildSponsoredTransaction: (params: BuildSponsoredTxParams) => Promise<string>;
  signAsSponsor: (unsignedXdr: string, sponsorSecretOrKeypair: string | Keypair) => string;
  signAsSponsored: (unsignedXdr: string, sponsoredSecretOrKeypair: string | Keypair) => string;
  submitSponsoredTransaction: (signedXdr: string) => Promise<SubmitResult>;
  submitWithSecrets: (
    params: BuildSponsoredTxParams,
    sponsorSecret: string,
    sponsoredSecret: string
  ) => Promise<SubmitResult>;
  clearError: () => void;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

export function useSponsoredReserves(
  options: UseSponsoredReservesOptions = {}
): SponsoredReservesState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
    networkPassphrase,
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
    if (networkPassphrase) return networkPassphrase;
    return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  }, [network, networkPassphrase]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const validateKey = useCallback((key: string, label: string) => {
    if (!key || typeof key !== 'string' || !StrKey.isValidEd25519PublicKey(key)) {
      throw new Error(`Invalid ${label} address format`);
    }
  }, []);

  /**
   * Builds an unsigned transaction where inner operations are wrapped in
   * beginSponsoringFutureReserves / endSponsoringFutureReserves.
   * Dual signatures (sponsor + sponsored) are required before submission.
   */
  const buildSponsoredTransaction = useCallback(
    async (params: BuildSponsoredTxParams): Promise<string> => {
      validateKey(params.sponsor, 'sponsor');
      validateKey(params.sponsored, 'sponsored');

      if (params.sponsor === params.sponsored) {
        throw new Error('Sponsor and sponsored account cannot be the same address');
      }

      if (!params.operations || !Array.isArray(params.operations) || params.operations.length === 0) {
        throw new Error('At least one inner operation to sponsor must be provided');
      }

      setLoading(true);
      setError(null);

      try {
        if (!serverRef.current) {
          throw new Error('Horizon server not initialized');
        }

        let sponsorAccount: Horizon.AccountResponse;
        try {
          sponsorAccount = await serverRef.current.loadAccount(params.sponsor);
        } catch (err: unknown) {
          const errObj = err as { response?: { status?: number }; message?: string };
          if (errObj?.response?.status === 404) {
            throw new Error(`Sponsor account ${params.sponsor} does not exist on the network`);
          }
          if (errObj?.response?.status && errObj.response.status >= 500) {
            throw new Error(`Network error: ${errObj.message || 'Failed to connect to Horizon'}`);
          }
          throw err instanceof Error ? err : new Error(String(err));
        }

        const txBuilder = new TransactionBuilder(sponsorAccount, {
          fee: params.fee || BASE_FEE,
          networkPassphrase: getNetworkPassphrase(),
        });

        // 1. Begin sponsorship of future reserves
        txBuilder.addOperation(
          Operation.beginSponsoringFutureReserves({
            sponsoredId: params.sponsored,
          })
        );

        // 2. Add inner operations (must set source = sponsored if not already set)
        for (const op of params.operations) {
          txBuilder.addOperation(op);
        }

        // 3. End sponsorship of future reserves (source MUST be the sponsored account)
        txBuilder.addOperation(
          Operation.endSponsoringFutureReserves({
            source: params.sponsored,
          })
        );

        txBuilder.setTimeout(30);
        const transaction = txBuilder.build();
        return transaction.toXDR();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [getNetworkPassphrase, validateKey]
  );

  /**
   * Signs transaction as sponsor.
   */
  const signAsSponsor = useCallback(
    (unsignedXdr: string, sponsorSecretOrKeypair: string | Keypair): string => {
      try {
        const tx = new Transaction(unsignedXdr, getNetworkPassphrase());
        const keypair =
          typeof sponsorSecretOrKeypair === 'string'
            ? Keypair.fromSecret(sponsorSecretOrKeypair)
            : sponsorSecretOrKeypair;

        tx.sign(keypair);
        return tx.toXDR();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [getNetworkPassphrase]
  );

  /**
   * Signs transaction as sponsored account (completes dual-signature flow).
   */
  const signAsSponsored = useCallback(
    (unsignedXdr: string, sponsoredSecretOrKeypair: string | Keypair): string => {
      try {
        const tx = new Transaction(unsignedXdr, getNetworkPassphrase());
        const keypair =
          typeof sponsoredSecretOrKeypair === 'string'
            ? Keypair.fromSecret(sponsoredSecretOrKeypair)
            : sponsoredSecretOrKeypair;

        tx.sign(keypair);
        return tx.toXDR();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      }
    },
    [getNetworkPassphrase]
  );

  /**
   * Submits dual-signed sponsored transaction to Horizon.
   */
  const submitSponsoredTransaction = useCallback(
    async (signedXdr: string): Promise<SubmitResult> => {
      if (!serverRef.current) {
        const err = new Error('Horizon server not initialized');
        setError(err);
        return { success: false, error: err.message };
      }

      setLoading(true);
      setError(null);

      try {
        const tx = new Transaction(signedXdr, getNetworkPassphrase());
        if (tx.signatures.length < 2) {
          throw new Error(
            `Dual signatures required: transaction currently has ${tx.signatures.length} signature(s), expected at least 2`
          );
        }

        const result = await serverRef.current.submitTransaction(tx);
        return {
          success: true,
          hash: result.hash,
          raw: result,
        };
      } catch (err: unknown) {
        const errObj = err as {
          response?: { data?: { extras?: { result_codes?: unknown } }; status?: number };
          message?: string;
        };

        const resultCodes = errObj?.response?.data?.extras?.result_codes;
        const errorMessage = resultCodes
          ? `Transaction rejected by Horizon: ${JSON.stringify(resultCodes)}`
          : errObj?.message || 'Transaction submission failed';

        const error = new Error(errorMessage);
        setError(error);
        return {
          success: false,
          error: errorMessage,
          raw: errObj?.response?.data || err,
        };
      } finally {
        setLoading(false);
      }
    },
    [getNetworkPassphrase]
  );

  /**
   * Convenience dual-signature builder and submitter using developer secret keys.
   */
  const submitWithSecrets = useCallback(
    async (
      params: BuildSponsoredTxParams,
      sponsorSecret: string,
      sponsoredSecret: string
    ): Promise<SubmitResult> => {
      try {
        const unsignedXdr = await buildSponsoredTransaction(params);
        const sponsorSignedXdr = signAsSponsor(unsignedXdr, sponsorSecret);
        const fullySignedXdr = signAsSponsored(sponsorSignedXdr, sponsoredSecret);
        return await submitSponsoredTransaction(fullySignedXdr);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
    [buildSponsoredTransaction, signAsSponsor, signAsSponsored, submitSponsoredTransaction]
  );

  return {
    loading,
    error,
    buildSponsoredTransaction,
    signAsSponsor,
    signAsSponsored,
    submitSponsoredTransaction,
    submitWithSecrets,
    clearError,
  };
}
