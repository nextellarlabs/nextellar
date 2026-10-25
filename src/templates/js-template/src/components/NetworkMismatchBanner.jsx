"use client";

import { useEffect, useState } from "react";
import { Networks } from "@stellar/stellar-sdk";
import { useWallet, useWalletConfig } from "../contexts";
import { kit } from "../lib/stellar-wallet-kit";

/**
 * A human-readable label for a Stellar network passphrase, falling back to
 * the raw passphrase for anything the app doesn't name (e.g. a futurenet or
 * standalone passphrase passed via `horizonUrl`/`network` overrides).
 */
function networkLabel(passphrase) {
  if (passphrase === Networks.PUBLIC) return "Mainnet";
  if (passphrase === Networks.TESTNET) return "Testnet";
  if (passphrase === Networks.FUTURENET) return "Futurenet";
  if (passphrase === Networks.STANDALONE) return "Standalone";
  return passphrase;
}

/**
 * Warns when the wallet connected via `WalletConnectButton` is on a
 * different Stellar network than this app is configured for (the
 * `network` passed to `WalletProvider`, e.g. testnet vs mainnet). Signing
 * a transaction built for one network with a wallet pinned to another
 * either fails outright or, worse, succeeds against the wrong network, so
 * this surfaces the mismatch as soon as it's known rather than letting the
 * user discover it from a failed submit.
 *
 * Renders nothing when no wallet is connected, the wallet hasn't reported
 * its network yet, or the networks already match.
 *
 * @param {object} [props]
 * @param {string | null} [props.walletNetworkPassphrase] - The connected
 *   wallet's reported network passphrase. When omitted (the normal case),
 *   the banner asks the active wallet connector for it via `getNetwork()`
 *   and keeps that in sync while a wallet is connected. Exposed as a prop
 *   mainly so tests and stories can drive the banner without a real wallet
 *   extension.
 * @param {() => void} [props.onDisconnect] - Called once a mismatch is
 *   detected and the user clicks "Disconnect". Defaults to the wallet
 *   context's own `disconnect`.
 *
 * @example
 * ```jsx
 * <NetworkMismatchBanner />
 * ```
 */
export default function NetworkMismatchBanner({
  walletNetworkPassphrase,
  onDisconnect,
} = {}) {
  const { connected, disconnect } = useWallet();
  const config = useWalletConfig();
  const [detectedPassphrase, setDetectedPassphrase] = useState(null);

  const isControlled = walletNetworkPassphrase !== undefined;
  const walletPassphrase = isControlled
    ? walletNetworkPassphrase
    : detectedPassphrase;

  useEffect(() => {
    // Controlled mode (tests/stories): never touch the real wallet kit.
    if (isControlled) return;

    if (!connected) {
      setDetectedPassphrase(null);
      return;
    }

    let cancelled = false;
    kit()
      .getNetwork()
      .then(({ networkPassphrase }) => {
        if (!cancelled) setDetectedPassphrase(networkPassphrase);
      })
      .catch(() => {
        // Wallet doesn't support getNetwork, or the user disconnected
        // mid-request. Fail quiet: no banner is safer than a stale one.
        if (!cancelled) setDetectedPassphrase(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, isControlled]);

  if (!connected || !config || !walletPassphrase) {
    return null;
  }

  if (walletPassphrase === config.network) {
    return null;
  }

  const handleDisconnect = () => {
    if (onDisconnect) {
      onDisconnect();
    } else {
      disconnect();
    }
  };

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <p>
        Your wallet is connected to{" "}
        <span className="font-semibold">
          {networkLabel(walletPassphrase)}
        </span>
        , but this app is configured for{" "}
        <span className="font-semibold">{networkLabel(config.network)}</span>
        . Switch your wallet's network or reconnect to continue.
      </p>
      <button
        type="button"
        onClick={handleDisconnect}
        className="shrink-0 rounded-full border border-amber-400 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
      >
        Disconnect
      </button>
    </div>
  );
}
