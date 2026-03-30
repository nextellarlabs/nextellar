/**
 * Feature registry for nextellar add.
 * Each feature lists relative paths from the default template (src/...) and optional npm deps.
 * Dependencies are other feature keys that must be added first.
 */

export interface FeatureDef {
  id: string;
  description: string;
  /** Relative paths under template src (e.g. "contexts/WalletProvider.tsx") */
  files: string[];
  /** Other feature ids that must be installed first */
  dependsOn: string[];
  /** npm packages to ensure installed (e.g. @stellar/stellar-sdk) */
  npmDependencies: string[];
}

const FEATURES: Record<string, FeatureDef> = {
  wallet: {
    id: "wallet",
    description: "Wallet connection: WalletProvider, WalletConnectButton, stellar-wallet-kit, useStellarWallet",
    files: [
      "contexts/WalletProvider.tsx",
      "components/WalletConnectButton.tsx",
      "lib/stellar-wallet-kit.ts",
      "hooks/useStellarWallet.ts",
    ],
    dependsOn: [],
    npmDependencies: ["@stellar/stellar-sdk", "@creit.tech/stellar-wallets-kit"],
  },
  balances: {
    id: "balances",
    description: "Account balances: useStellarBalances hook",
    files: ["hooks/useStellarBalances.ts"],
    dependsOn: ["wallet"],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
  payments: {
    id: "payments",
    description: "Send payments: useStellarPayment hook",
    files: ["hooks/useStellarPayment.ts"],
    dependsOn: ["wallet"],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
  history: {
    id: "history",
    description: "Transaction history: useTransactionHistory hook",
    files: ["hooks/useTransactionHistory.ts"],
    dependsOn: [],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
  trustlines: {
    id: "trustlines",
    description: "Trust lines: useTrustlines hook",
    files: ["hooks/useTrustlines.ts"],
    dependsOn: ["wallet"],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
  defi: {
    id: "defi",
    description: "DEX / order book: useOfferBook and useTrustlines",
    files: ["hooks/useOfferBook.ts", "hooks/useTrustlines.ts"],
    dependsOn: ["wallet"],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
  contracts: {
    id: "contracts",
    description: "Soroban contracts: useSorobanContract, useSorobanEvents",
    files: ["hooks/useSorobanContract.ts", "hooks/useSorobanEvents.ts"],
    dependsOn: ["wallet"],
    npmDependencies: ["@stellar/stellar-sdk"],
  },
};

/**
 * Returns all registered feature ids.
 */
export function getFeatureIds(): string[] {
  return Object.keys(FEATURES);
}

/**
 * Returns the feature definition for an id, or undefined.
 */
export function getFeature(id: string): FeatureDef | undefined {
  return FEATURES[id];
}

/**
 * Returns feature definitions for listing (id, description).
 */
export function listFeatures(): { id: string; description: string }[] {
  return getFeatureIds().map((id) => {
    const f = FEATURES[id];
    return { id, description: f.description };
  });
}

/**
 * Resolves a feature and its dependencies in install order (deps first).
 * No duplicates; order is valid for installation.
 */
export function resolveFeatureWithDeps(featureId: string): FeatureDef[] {
  const id = featureId.toLowerCase();
  const def = FEATURES[id];
  if (!def) return [];

  const seen = new Set<string>();
  const ordered: FeatureDef[] = [];

  function visit(f: FeatureDef) {
    for (const depId of f.dependsOn) {
      const dep = FEATURES[depId];
      if (dep && !seen.has(depId)) visit(dep);
    }
    if (!seen.has(f.id)) {
      seen.add(f.id);
      ordered.push(f);
    }
  }

  visit(def);
  return ordered;
}
