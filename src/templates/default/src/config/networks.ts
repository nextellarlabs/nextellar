export interface NetworkConfig {
  name: string;
  horizonUrl: string;
  sorobanUrl: string;
  passphrase: string;
  /**
   * Set on entries added at runtime via `addCustomNetwork` (issue #1107) so
   * the UI can distinguish them from the built-in testnet/mainnet presets —
   * e.g. to offer a "remove" action only for custom entries.
   */
  isCustom?: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    name: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    name: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
    sorobanUrl: "https://soroban.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
  },
};

/**
 * Validates a Horizon/Soroban RPC URL the same way the CLI's `doctor`
 * command validates `--horizon-url`/`--soroban-url` (issue #831): must parse
 * as a URL and use http/https. Exported so both the WalletProvider and any
 * UI form built on top of it (NetworkSwitcher's "add custom network" entry)
 * share one validation rule rather than drifting.
 */
export function assertValidNetworkUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label}: "${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label}: "${url}" must use http or https.`);
  }
}
