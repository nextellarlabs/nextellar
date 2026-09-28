'use client';

import { useCallback, useState } from 'react';
import {
  discoverSep30RecoveryServer,
  recoverSep30Account,
  registerSep30Account,
  type Sep30RecoverResponse,
  type Sep30RecoveryServer,
} from '../lib/sep30';

export interface UseSep30RecoveryOptions {
  homeDomain?: string;
  serverUrl?: string;
}

export interface UseSep30RecoveryReturn {
  discover: (homeDomain: string) => Promise<Sep30RecoveryServer>;
  register: (params: {
    accountId: string;
    authToken: string;
    signers: string[];
    serverUrl?: string;
  }) => Promise<void>;
  recover: (params: {
    accountId: string;
    recoveryToken: string;
    serverUrl?: string;
  }) => Promise<Sep30RecoverResponse>;
  loading: boolean;
  error: Error | null;
}

/**
 * React hook wrapper for SEP-30 recovery server registration and recovery flows.
 */
export function useSep30Recovery(
  opts: UseSep30RecoveryOptions = {},
): UseSep30RecoveryReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const resolveServerUrl = useCallback(
    (override?: string) => override ?? opts.serverUrl,
    [opts.serverUrl],
  );

  const discover = useCallback(async (homeDomain: string) => {
    setLoading(true);
    setError(null);
    try {
      return await discoverSep30RecoveryServer(homeDomain);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(
    async (params: {
      accountId: string;
      authToken: string;
      signers: string[];
      serverUrl?: string;
    }) => {
      const serverUrl = resolveServerUrl(params.serverUrl);
      if (!serverUrl && !opts.homeDomain) {
        throw new Error('register: serverUrl or hook homeDomain is required');
      }
      setLoading(true);
      setError(null);
      try {
        const url =
          serverUrl ??
          (await discoverSep30RecoveryServer(opts.homeDomain!)).serverUrl;
        await registerSep30Account({
          serverUrl: url,
          accountId: params.accountId,
          authToken: params.authToken,
          signers: params.signers,
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [opts.homeDomain, resolveServerUrl],
  );

  const recover = useCallback(
    async (params: {
      accountId: string;
      recoveryToken: string;
      serverUrl?: string;
    }) => {
      const serverUrl = resolveServerUrl(params.serverUrl);
      if (!serverUrl && !opts.homeDomain) {
        throw new Error('recover: serverUrl or hook homeDomain is required');
      }
      setLoading(true);
      setError(null);
      try {
        const url =
          serverUrl ??
          (await discoverSep30RecoveryServer(opts.homeDomain!)).serverUrl;
        return await recoverSep30Account({
          serverUrl: url,
          accountId: params.accountId,
          recoveryToken: params.recoveryToken,
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [opts.homeDomain, resolveServerUrl],
  );

  return { discover, register, recover, loading, error };
}
