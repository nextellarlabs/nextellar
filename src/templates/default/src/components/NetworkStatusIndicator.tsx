'use client';

import { useNetworkStatus } from '../contexts/NetworkStatusContext';

/**
 * Banner shown when Horizon and/or Soroban RPC are unreachable, so users see
 * why data stopped updating instead of an opaque failure. Renders nothing
 * while everything is healthy, during the first check, or outside a
 * `NetworkStatusProvider`.
 *
 * @example
 * ```tsx
 * <NetworkStatusProvider>
 *   <NetworkStatusIndicator />
 *   {children}
 * </NetworkStatusProvider>
 * ```
 */
export default function NetworkStatusIndicator() {
  const state = useNetworkStatus();

  if (!state || state.status === 'online' || state.status === 'checking') {
    return null;
  }

  const offline = state.status === 'offline';
  const down = [state.horizon === 'down' && 'Horizon', state.rpc === 'down' && 'Soroban RPC']
    .filter(Boolean)
    .join(' and ');

  const tone = offline
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';

  return (
    <div
      role="alert"
      data-network-status={state.status}
      className={`rounded-xl border px-4 py-3 text-sm ${tone}`}
    >
      {offline ? (
        <p>
          <span className="font-semibold">Stellar network unreachable.</span> Horizon and Soroban
          RPC are both down. Live updates are paused and will resume automatically.
        </p>
      ) : (
        <p>
          <span className="font-semibold">Degraded connection.</span> {down} is not responding.
          Related updates are paused and will resume automatically.
        </p>
      )}
    </div>
  );
}
