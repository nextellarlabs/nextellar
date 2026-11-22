'use client';
import { useCallback, useState } from 'react';
import {
    discoverSep30RecoveryServer,
    recoverSep30Account,
    registerSep30Account,
} from '../lib/sep30';

/**
 * React hook wrapper for SEP-30 recovery server registration and recovery flows.
 *
 * @param {{homeDomain?: string, serverUrl?: string}} [opts]
 *
 * @example
 * ```jsx
 * const recovery = useSep30Recovery({ homeDomain: 'example.com' });
 * await recovery.register({ accountId, authToken: jwt, signers: [recoverySignerKey] });
 * const { transaction } = await recovery.recover({ accountId, recoveryToken });
 * ```
 */
export function useSep30Recovery(opts = {}) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const resolveServerUrl = useCallback((override) => override ?? opts.serverUrl, [opts.serverUrl]);

    const discover = useCallback(async (homeDomain) => {
        setLoading(true);
        setError(null);
        try {
            return await discoverSep30RecoveryServer(homeDomain);
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            setError(e);
            throw e;
        }
        finally {
            setLoading(false);
        }
    }, []);

    const register = useCallback(async (params) => {
        const serverUrl = resolveServerUrl(params.serverUrl);
        if (!serverUrl && !opts.homeDomain) {
            throw new Error('register: serverUrl or hook homeDomain is required');
        }
        setLoading(true);
        setError(null);
        try {
            const url = serverUrl ?? (await discoverSep30RecoveryServer(opts.homeDomain)).serverUrl;
            await registerSep30Account({
                serverUrl: url,
                accountId: params.accountId,
                authToken: params.authToken,
                signers: params.signers,
            });
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            setError(e);
            throw e;
        }
        finally {
            setLoading(false);
        }
    }, [opts.homeDomain, resolveServerUrl]);

    const recover = useCallback(async (params) => {
        const serverUrl = resolveServerUrl(params.serverUrl);
        if (!serverUrl && !opts.homeDomain) {
            throw new Error('recover: serverUrl or hook homeDomain is required');
        }
        setLoading(true);
        setError(null);
        try {
            const url = serverUrl ?? (await discoverSep30RecoveryServer(opts.homeDomain)).serverUrl;
            return await recoverSep30Account({
                serverUrl: url,
                accountId: params.accountId,
                recoveryToken: params.recoveryToken,
            });
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            setError(e);
            throw e;
        }
        finally {
            setLoading(false);
        }
    }, [opts.homeDomain, resolveServerUrl]);

    return { discover, register, recover, loading, error };
}
