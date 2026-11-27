'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, Networks, StrKey } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export interface StellarAccountSigner {
  key: string;
  weight: number;
  type: string;
  sponsor?: string;
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

export interface StellarAccountDetails {
  id: string;
  accountId: string;
  sequence: string;
  subentryCount: number;
  homeDomain?: string;
  thresholds: StellarAccountThresholds;
  flags: StellarAccountFlags;
  signers: StellarAccountSigner[];
}

export interface UseStellarAccountOptions {
  horizonUrl?: string;
  networkPassphrase?: string;
}

export interface StellarAccountState {
  account: StellarAccountDetails | null;
  signers: StellarAccountSigner[];
  thresholds: StellarAccountThresholds | null;
  flags: StellarAccountFlags | null;
  sequence: string | null;
  exists: boolean;
  loading: boolean;
  error: Error | null;
  horizonUrl: string;
  networkPassphrase: string;
  refresh: () => Promise<void>;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

/**
 * Fetches full Stellar account metadata (signers, thresholds, flags, sequence)
 * from Horizon. Handles unfunded 404 accounts gracefully (`exists: false`,
 * `account: null`, `error: null`) without throwing.
 */
export function useStellarAccount(
  publicKey?: string | null,
  options: UseStellarAccountOptions = {},
): StellarAccountState {
  const providerConfig = useWalletConfig();
  const horizonUrl =
    options.horizonUrl ?? providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL;
  const networkPassphrase =
    options.networkPassphrase ?? providerConfig?.network ?? Networks.TESTNET;

  const [account, setAccount] = useState<StellarAccountDetails | null>(null);
  const [exists, setExists] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const serverRef = useRef<{ url: string; client: Horizon.Server } | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getServer = useCallback((): Horizon.Server => {
    if (!serverRef.current || serverRef.current.url !== horizonUrl) {
      serverRef.current = {
        url: horizonUrl,
        client: new Horizon.Server(horizonUrl),
      };
    }
    return serverRef.current.client;
  }, [horizonUrl]);

  const refresh = useCallback(async (): Promise<void> => {
    const trimmedKey = publicKey?.trim() ?? '';
    if (!trimmedKey) {
      setAccount(null);
      setExists(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (!StrKey.isValidEd25519PublicKey(trimmedKey)) {
      setAccount(null);
      setExists(false);
      setLoading(false);
      setError(new Error('Invalid Stellar public key format'));
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const server = getServer();
      const raw = await server.accounts().accountId(trimmedKey).call();

      if (!mountedRef.current || seq !== requestSeqRef.current) {
        return;
      }

      const mappedSigners: StellarAccountSigner[] = Array.isArray(raw.signers)
        ? raw.signers.map((s) => {
            const sponsor =
              'sponsor' in s && typeof s.sponsor === 'string'
                ? s.sponsor
                : undefined;
            return {
              key: s.key,
              weight: Number(s.weight),
              type: s.type,
              ...(sponsor ? { sponsor } : {}),
            };
          })
        : [];

      const mappedThresholds: StellarAccountThresholds = {
        low_threshold: Number(raw.thresholds?.low_threshold ?? 0),
        med_threshold: Number(raw.thresholds?.med_threshold ?? 0),
        high_threshold: Number(raw.thresholds?.high_threshold ?? 0),
      };

      const mappedFlags: StellarAccountFlags = {
        auth_required: Boolean(raw.flags?.auth_required),
        auth_revocable: Boolean(raw.flags?.auth_revocable),
        auth_immutable: Boolean(raw.flags?.auth_immutable),
        ...(raw.flags && 'auth_clawback_enabled' in raw.flags
          ? { auth_clawback_enabled: Boolean(raw.flags.auth_clawback_enabled) }
          : {}),
      };

      const details: StellarAccountDetails = {
        id: raw.id ?? trimmedKey,
        accountId: raw.account_id ?? trimmedKey,
        sequence: String(raw.sequence),
        subentryCount: Number(raw.subentry_count ?? 0),
        ...(raw.home_domain ? { homeDomain: raw.home_domain } : {}),
        thresholds: mappedThresholds,
        flags: mappedFlags,
        signers: mappedSigners,
      };

      setAccount(details);
      setExists(true);
      setError(null);
    } catch (err: unknown) {
      if (!mountedRef.current || seq !== requestSeqRef.current) {
        return;
      }

      const errObj = err as {
        response?: { status?: number };
        name?: string;
        message?: string;
      };

      if (
        errObj?.response?.status === 404 ||
        errObj?.name === 'NotFoundError'
      ) {
        setAccount(null);
        setExists(false);
        setError(null);
      } else {
        const wrapped =
          err instanceof Error
            ? err
            : new Error(errObj?.message || 'Failed to load Stellar account');
        setError(wrapped);
      }
    } finally {
      if (mountedRef.current && seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [publicKey, getServer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    account,
    signers: account?.signers ?? [],
    thresholds: account?.thresholds ?? null,
    flags: account?.flags ?? null,
    sequence: account?.sequence ?? null,
    exists,
    loading,
    error,
    horizonUrl,
    networkPassphrase,
    refresh,
  };
}
