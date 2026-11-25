'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

/**
 * Network selection for the account merge transaction.
 */
export type AccountMergeNetwork = 'TESTNET' | 'PUBLIC';

/**
 * Options for the useAccountMerge hook.
 */
export interface UseAccountMergeOptions {
  horizonUrl?: string;
  network?: AccountMergeNetwork;
}

/**
 * A pre-flight condition that makes an account merge unsafe.
 */
export type AccountMergeBlockerType =
  | 'open-offers'
  | 'non-native-balance'
  | 'sponsored-entries';

export interface AccountMergeBlocker {
  type: AccountMergeBlockerType;
  message: string;
  /** Human-readable details for each offending offer / balance / entry. */
  details?: string[];
}

export interface AccountMergeSafetyReport {
  source: string;
  blockers: AccountMergeBlocker[];
  safe: boolean;
}

/**
 * Parameters for building an unsigned account merge XDR.
 *
 * `confirm` must be exactly `true`; this is deliberate friction for a
 * destructive operation that permanently removes the source account.
 */
export type AccountMergeParams = {
  source: string;
  destination: string;
  confirm: boolean;
  fee?: number | string;
};

export interface AccountMergeState {
  loading: boolean;
  error: Error | null;
  blockers: AccountMergeBlocker[];
  checkSafety: (source: string) => Promise<AccountMergeSafetyReport>;
  buildAccountMergeXDR: (params: AccountMergeParams) => Promise<string>;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK: AccountMergeNetwork = 'TESTNET';

/**
 * Custom React hook for safely merging a Stellar account into a destination.
 *
 * Account merge is irreversible: the source account is removed and its
 * remaining native balance is transferred to the destination. Before the
 * `accountMerge` operation is built, the hook queries Horizon and refuses to
 * proceed when the source still has open offers, non-zero non-native balances,
 * or sponsored entries. Every blocker is returned so a UI can show the user
 * exactly what must be cleaned up first.
 *
 * @param options - Horizon URL and network selection. The Horizon URL falls
 * back to the wallet provider configuration when available.
 *
 * @example
 * ```tsx
 * const { loading, error, blockers, buildAccountMergeXDR } = useAccountMerge({
 *   network: 'TESTNET'
 * });
 *
 * const xdr = await buildAccountMergeXDR({
 *   source: publicKey,
 *   destination: destinationKey,
 *   confirm: true // explicit consent is required
 * });
 * // Hand `xdr` to the connected wallet for signing.
 * ```
 */
export function useAccountMerge(
  options: UseAccountMergeOptions = {}
): AccountMergeState {
  // Auto-consume provider config as fallback, like the sibling hooks.
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK
  } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [blockers, setBlockers] = useState<AccountMergeBlocker[]>([]);

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

  const isValidAddress = useCallback((address: string): boolean => {
    return address.length === 56 && address.startsWith('G');
  }, []);

  const describeError = useCallback(
    (err: unknown, fallback: string, source?: string): Error => {
      const errorObj = err as {
        message?: string;
        name?: string;
        response?: { status?: number; data?: unknown };
      };
      const status = errorObj?.response?.status;

      if (status === 404 || errorObj?.name === 'NotFoundError') {
        return new Error(
          `Account ${source ?? 'source'} not found. Account may need funding.`
        );
      }
      if (errorObj?.message?.includes('fetch') || (status && status >= 500)) {
        return new Error(
          `Network error: ${errorObj.message || 'Failed to connect to Horizon'}`
        );
      }
      if (status && status >= 400 && status < 500) {
        return new Error(
          `Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${status})`
        );
      }
      return err instanceof Error ? err : new Error(fallback);
    },
    []
  );

  /**
   * Read-only pre-flight check. No state is mutated here so both the public
   * `checkSafety` helper and `buildAccountMergeXDR` can share it.
   */
  const collectBlockers = useCallback(
    async (source: string): Promise<AccountMergeSafetyReport> => {
      if (!serverRef.current) {
        throw new Error('Horizon server not initialized');
      }
      if (!isValidAddress(source)) {
        throw new Error('Invalid source address format');
      }

      try {
        const account = await serverRef.current
          .accounts()
          .accountId(source)
          .call();
        const offers = await serverRef.current
          .offers()
          .forAccount(source)
          .call();

        if (!account || !Array.isArray(account.balances)) {
          throw new Error('Invalid account structure received from Horizon');
        }

        const found: AccountMergeBlocker[] = [];

        const openOffers = offers?.records ?? [];
        if (openOffers.length > 0) {
          found.push({
            type: 'open-offers',
            message: `${openOffers.length} open offer(s) must be removed before merging`,
            details: openOffers.map((offer) => String(offer.id))
          });
        }

        const nonNativeBalances = account.balances.filter(
          (balance) =>
            balance.asset_type !== 'native' &&
            Number.parseFloat(balance.balance) > 0
        );
        if (nonNativeBalances.length > 0) {
          found.push({
            type: 'non-native-balance',
            message: 'Non-native asset balances must be zero before merging',
            details: nonNativeBalances.map((balance) => {
              const code = 'asset_code' in balance ? balance.asset_code : 'asset';
              return `${code}: ${balance.balance}`;
            })
          });
        }

        const accountRecord = account as typeof account & {
          sponsor?: string;
          num_sponsoring?: number;
          num_sponsored?: number;
        };
        const sponsoring = Number(accountRecord.num_sponsoring ?? 0);
        const sponsored = Number(accountRecord.num_sponsored ?? 0);
        if (sponsoring > 0 || sponsored > 0 || Boolean(accountRecord.sponsor)) {
          const details: string[] = [];
          if (sponsoring > 0) {
            details.push(`${sponsoring} sponsored entry/entries created by this account`);
          }
          if (sponsored > 0) {
            details.push(`${sponsored} entries sponsored by other accounts`);
          }
          if (accountRecord.sponsor) {
            details.push('the account itself is sponsored');
          }
          found.push({
            type: 'sponsored-entries',
            message: 'Sponsored entries must be removed before merging',
            details
          });
        }

        return { source, blockers: found, safe: found.length === 0 };
      } catch (err) {
        throw describeError(
          err,
          'Failed to check account merge safety',
          source
        );
      }
    },
    [describeError, isValidAddress]
  );

  /**
   * Run the pre-flight check and expose its blockers via hook state.
   */
  const checkSafety = useCallback(
    async (source: string): Promise<AccountMergeSafetyReport> => {
      setLoading(true);
      setError(null);
      try {
        const report = await collectBlockers(source);
        setBlockers(report.blockers);
        return report;
      } catch (err) {
        const normalized =
          err instanceof Error ? err : new Error('Failed to check account merge safety');
        setError(normalized);
        setBlockers([]);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [collectBlockers]
  );

  /**
   * Build an unsigned account merge XDR after validating the explicit confirm
   * flag and running every safety check.
   */
  const buildAccountMergeXDR = useCallback(
    async (params: AccountMergeParams): Promise<string> => {
      if (!serverRef.current) {
        throw new Error('Horizon server not initialized');
      }
      if (!isValidAddress(params.source)) {
        throw new Error('Invalid source address format');
      }
      if (!isValidAddress(params.destination)) {
        throw new Error('Invalid destination address format');
      }
      if (params.source === params.destination) {
        throw new Error('Source and destination cannot be the same account');
      }
      // Explicit consent must be checked before any network work.
      if (params.confirm !== true) {
        throw new Error(
          'Explicit confirm: true is required to build an account merge transaction'
        );
      }

      setLoading(true);
      setError(null);
      try {
        const report = await collectBlockers(params.source);
        setBlockers(report.blockers);
        if (!report.safe) {
          throw new Error(
            `Account merge blocked: ${report.blockers.map((blocker) => blocker.message).join('; ')}`
          );
        }

        const account = await serverRef.current.loadAccount(params.source);
        const txBuilder = new TransactionBuilder(account, {
          fee: String(params.fee ?? BASE_FEE),
          networkPassphrase: getNetworkPassphrase()
        });
        txBuilder.addOperation(
          Operation.accountMerge({ destination: params.destination })
        );
        txBuilder.setTimeout(30);
        return txBuilder.build().toXDR();
      } catch (err) {
        const normalized = describeError(
          err,
          'Failed to build account merge transaction',
          params.source
        );
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [collectBlockers, describeError, getNetworkPassphrase, isValidAddress]
  );

  return {
    loading,
    error,
    blockers,
    checkSafety,
    buildAccountMergeXDR
  };
}
