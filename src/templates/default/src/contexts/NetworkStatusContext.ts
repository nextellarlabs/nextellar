'use client';

import { createContext, useContext } from 'react';

/** Result of the latest probe of one backend. `checking` until the first probe returns. */
export type ServiceStatus = 'checking' | 'up' | 'down';

/**
 * Combined view of Horizon + Soroban RPC:
 * - `checking`: first probe still in flight
 * - `online`:   both up
 * - `degraded`: exactly one is down
 * - `offline`:  both are down
 */
export type NetworkStatus = 'checking' | 'online' | 'degraded' | 'offline';

export interface NetworkStatusState {
  status: NetworkStatus;
  horizon: ServiceStatus;
  rpc: ServiceStatus;
  /** `Date.now()` of the last completed probe, or null before the first. */
  lastCheckedAt: number | null;
}

export const NetworkStatusContext = createContext<NetworkStatusState | undefined>(undefined);

/** Combines the two per-service results into the overall status. */
export function deriveNetworkStatus(horizon: ServiceStatus, rpc: ServiceStatus): NetworkStatus {
  if (horizon === 'checking' || rpc === 'checking') return 'checking';
  if (horizon === 'up' && rpc === 'up') return 'online';
  if (horizon === 'down' && rpc === 'down') return 'offline';
  return 'degraded';
}

/**
 * Current Horizon/RPC health, or `undefined` outside a `NetworkStatusProvider`
 * (mirrors `useWalletConfig`, so standalone usage keeps working).
 */
export function useNetworkStatus(): NetworkStatusState | undefined {
  return useContext(NetworkStatusContext);
}

/**
 * True while the given backend is known to be down. Polling hooks use this to
 * stop their timers and resume when it flips back to false. Always false
 * outside a provider and while the first probe is still running, so a hook
 * never pauses on a guess.
 */
export function useNetworkPaused(service: 'horizon' | 'rpc'): boolean {
  const state = useContext(NetworkStatusContext);
  return state?.[service] === 'down';
}
