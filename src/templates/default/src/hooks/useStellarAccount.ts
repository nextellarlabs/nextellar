'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export interface StellarAccountSigner {
  key: string;
  weight: number;
  type: string;
}

export interface StellarAccountThresholds {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

export interface StellarAccountFlags {
  auth_required: boolean;
  auth_revocable: boolean;
  auth_immutable: boolean;
  auth_clawback_enabled?: boolean;
}

/** The Horizon account fields commonly needed to inspect account authority and sponsorship. */
export interface StellarAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  thresholds: StellarAccountThresholds;
  flags: StellarAccountFlags;
  signers: StellarAccountSigner[];
  home_domain: string;
  num_sponsoring?: number;
  num_sponsored?: number;
  sponsor?: string;
}

export interface UseStellarAccountOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

export interface StellarAccountState {
  account: StellarAccount | null;
  loading: boolean;
  error: Error | null;
  networkPassphrase: string;
  refresh: () => Promise<void>;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAccount(value: unknown): StellarAccount {
  if (!isRecord(value) || !isRecord(value.thresholds) || !isRecord(value.flags)) {
    throw new Error('Invalid account structure received from Horizon');
  }

  const { thresholds, flags } = value;
  const isNumber = (item: unknown): item is number => typeof item === 'number';
  const isBoolean = (item: unknown): item is boolean => typeof item === 'boolean';

  if (
    typeof value.id !== 'string' ||
    typeof value.account_id !== 'string' ||
    typeof value.sequence !== 'string' ||
    !isNumber(value.subentry_count) ||
    !isNumber(thresholds.low_threshold) ||
    !isNumber(thresholds.med_threshold) ||
    !isNumber(thresholds.high_threshold) ||
    !isBoolean(flags.auth_required) ||
    !isBoolean(flags.auth_revocable) ||
    !isBoolean(flags.auth_immutable) ||
    (flags.auth_clawback_enabled !== undefined &&
      typeof flags.auth_clawback_enabled !== 'boolean') ||
    !Array.isArray(value.signers) ||
    typeof value.home_domain !== 'string'
  ) {
    throw new Error('Invalid account structure received from Horizon');
  }

  const signers = value.signers.map((signer): StellarAccountSigner => {
    if (
      !isRecord(signer) ||
      typeof signer.key !== 'string' ||
      !isNumber(signer.weight) ||
      typeof signer.type !== 'string'
    ) {
      throw new Error('Invalid account signer received from Horizon');
    }

    return { key: signer.key, weight: signer.weight, type: signer.type };
  });

  return {
    id: value.id,
    account_id: value.account_id,
    sequence: value.sequence,
    subentry_count: value.subentry_count,
    thresholds: {
      low_threshold: thresholds.low_threshold,
      med_threshold: thresholds.med_threshold,
      high_threshold: thresholds.high_threshold,
    },
    flags: {
      auth_required: flags.auth_required,
      auth_revocable: flags.auth_revocable,
      auth_immutable: flags.auth_immutable,
      ...(flags.auth_clawback_enabled === undefined
        ? {}
        : { auth_clawback_enabled: flags.auth_clawback_enabled }),
    },
    signers,
    home_domain: value.home_domain,
    ...(isNumber(value.num_sponsoring) ? { num_sponsoring: value.num_sponsoring } : {}),
    ...(isNumber(value.num_sponsored) ? { num_sponsored: value.num_sponsored } : {}),
    ...(typeof value.sponsor === 'string' ? { sponsor: value.sponsor } : {}),
  };
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined;
  return typeof error.response.status === 'number' ? error.response.status : undefined;
}

function getErrorName(error: unknown): string | undefined {
  return isRecord(error) && typeof error.name === 'string' ? error.name : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  return isRecord(error) && typeof error.message === 'string' ? error.message : undefined;
}

/**
 * Fetches account authority, network flags, home domain, and sponsorship details.
 * Unfunded accounts resolve to `account: null` without setting an error.
 */
export function useStellarAccount(
  publicKey?: string | null,
  options: UseStellarAccountOptions = {},
): StellarAccountState {
  const providerConfig = useWalletConfig();
  const horizonUrl = options.horizonUrl ?? providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL;
  const network = options.network ?? 'TESTNET';
  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  const [account, setAccount] = useState<StellarAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (lastHorizonUrlRef.current === horizonUrl) return;

    try {
      serverRef.current = new Horizon.Server(horizonUrl);
      lastHorizonUrlRef.current = horizonUrl;
    } catch (cause) {
      const initializationError = new Error(`Invalid Horizon URL: ${horizonUrl}`, { cause });
      setError(initializationError);
      serverRef.current = null;
    }
  }, [horizonUrl]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;

    if (!publicKey) {
      setAccount(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      setLoading(false);
      return;
    }

    if (publicKey.length !== 56 || !publicKey.startsWith('G')) {
      setError(new Error('Invalid Stellar public key format'));
      setLoading(false);
      return;
    }

    if (!serverRef.current) {
      setError(new Error('Horizon server not initialized'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await serverRef.current.accounts().accountId(publicKey).call();
      const parsedAccount = parseAccount(response);
      if (requestId === requestIdRef.current) {
        setAccount(parsedAccount);
        setError(null);
      }
    } catch (cause: unknown) {
      const status = getErrorStatus(cause);
      const message = getErrorMessage(cause);

      if (status === 404 || getErrorName(cause) === 'NotFoundError') {
        if (requestId === requestIdRef.current) {
          setAccount(null);
          setError(null);
        }
      } else {
        let nextError: Error;
        if (message?.includes('fetch') || (status !== undefined && status >= 500)) {
          nextError = new Error(`Network error: ${message || 'Failed to connect to Horizon'}`);
        } else if (status !== undefined && status >= 400) {
          nextError = new Error(
            `Client error: ${message || 'Invalid request to Horizon'} (Status: ${status})`,
          );
        } else {
          nextError = cause instanceof Error ? cause : new Error('Unknown error fetching Stellar account');
        }

        if (requestId === requestIdRef.current) {
          setError(nextError);
          console.error('Error fetching Stellar account:', nextError);
        }
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [horizonUrl, publicKey]);

  useEffect(() => {
    setAccount(null);
    setError(null);

    if (!publicKey) {
      setLoading(false);
      return;
    }

    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [publicKey, refresh]);

  return { account, loading, error, networkPassphrase, refresh };
}
