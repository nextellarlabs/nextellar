'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NETWORKS } from '../config/networks';
import {
  checkHorizonHealth,
  checkRpcHealth,
  computeBackoffDelay,
  HEALTH_CHECK_TIMEOUT_MS,
} from '../lib/networkHealth';
import {
  NetworkStatusContext,
  deriveNetworkStatus,
  type NetworkStatusState,
  type ServiceStatus,
} from './NetworkStatusContext';
import { useWalletConfig } from './WalletProvider';

export interface NetworkStatusProviderProps {
  children: ReactNode;
  /** Defaults to the surrounding `WalletProvider`'s Horizon URL, then testnet. */
  horizonUrl?: string;
  /** Defaults to the surrounding `WalletProvider`'s Soroban URL, then testnet. */
  sorobanUrl?: string;
  /** Delay between probes while everything is healthy. Default 30s. */
  healthyIntervalMs?: number;
  /** First retry delay after a failed probe; doubles per consecutive failure. Default 2s. */
  backoffBaseMs?: number;
  /** Upper bound for the retry delay. Default 60s. */
  backoffMaxMs?: number;
  /** Per-probe timeout. Default 5s. */
  timeoutMs?: number;
}

const DEFAULT_HEALTHY_INTERVAL_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 2_000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;

/**
 * Polls Horizon (`GET /`) and Soroban RPC (`getHealth`) and exposes the
 * result through `useNetworkStatus()` / `useNetworkPaused()`.
 *
 * While both are up it probes every `healthyIntervalMs`. After a failed probe
 * it retries with exponential backoff (plus jitter) and snaps back to the
 * healthy interval as soon as both answer. Timers and in-flight requests are
 * cleaned up on unmount and whenever the endpoints change.
 *
 * Mount it inside `WalletProvider` to follow the wallet's network, or pass
 * `horizonUrl` / `sorobanUrl` explicitly.
 */
export function NetworkStatusProvider({
  children,
  horizonUrl: horizonUrlProp,
  sorobanUrl: sorobanUrlProp,
  healthyIntervalMs = DEFAULT_HEALTHY_INTERVAL_MS,
  backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
  backoffMaxMs = DEFAULT_BACKOFF_MAX_MS,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
}: NetworkStatusProviderProps) {
  const walletConfig = useWalletConfig();
  const horizonUrl = horizonUrlProp ?? walletConfig?.horizonUrl ?? NETWORKS.testnet.horizonUrl;
  const sorobanUrl = sorobanUrlProp ?? walletConfig?.sorobanUrl ?? NETWORKS.testnet.sorobanUrl;

  const [horizon, setHorizon] = useState<ServiceStatus>('checking');
  const [rpc, setRpc] = useState<ServiceStatus>('checking');
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;

    // New endpoints (e.g. the user switched network): forget the old verdict.
    setHorizon('checking');
    setRpc('checking');
    setLastCheckedAt(null);

    const probe = async () => {
      controller = new AbortController();
      const options = { signal: controller.signal, timeoutMs };
      const [horizonUp, rpcUp] = await Promise.all([
        checkHorizonHealth(horizonUrl, options),
        checkRpcHealth(sorobanUrl, options),
      ]);
      if (cancelled) return;

      setHorizon(horizonUp ? 'up' : 'down');
      setRpc(rpcUp ? 'up' : 'down');
      setLastCheckedAt(Date.now());

      failures = horizonUp && rpcUp ? 0 : failures + 1;
      const delay =
        failures === 0
          ? healthyIntervalMs
          : computeBackoffDelay(failures, { baseMs: backoffBaseMs, maxMs: backoffMaxMs });
      timer = setTimeout(probe, delay);
    };

    void probe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [horizonUrl, sorobanUrl, healthyIntervalMs, backoffBaseMs, backoffMaxMs, timeoutMs]);

  const value = useMemo<NetworkStatusState>(
    () => ({ status: deriveNetworkStatus(horizon, rpc), horizon, rpc, lastCheckedAt }),
    [horizon, rpc, lastCheckedAt],
  );

  return <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>;
}
