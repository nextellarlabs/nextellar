/**
 * Feature registry for nextellar add.
 * Each feature lists relative paths from the default template (src/...) and optional npm deps.
 * Dependencies are other feature keys that must be added first.
 */

export type FeatureKind = "hook" | "component";

export interface FeatureDef {
  id: string;
  description: string;
  /** Relative paths under template src (e.g. "contexts/WalletProvider.tsx") */
  files: string[];
  /** Other feature ids that must be installed first */
  dependsOn: string[];
  /** npm packages to ensure installed (e.g. @stellar/stellar-sdk) */
  npmDependencies: string[];
  /** How the feature is grouped in `nextellar add --list` (default: "hook") */
  kind?: FeatureKind;
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

  // UI components. Each one is addable on its own so a project can pull in a
  // single widget, and each depends on the hook feature it imports from — that
  // is what guarantees the hooks land before the component that needs them.
  "network-switcher": {
    id: "network-switcher",
    description: "NetworkSwitcher component (testnet/mainnet toggle)",
    files: ["components/NetworkSwitcher.tsx"],
    dependsOn: ["wallet"],
    npmDependencies: [],
    kind: "component",
  },
  "balance-display": {
    id: "balance-display",
    description: "BalanceDisplay component (renders useStellarBalances)",
    files: ["components/BalanceDisplay.tsx"],
    dependsOn: ["balances"],
    npmDependencies: [],
    kind: "component",
  },
  "send-form": {
    id: "send-form",
    description: "SendForm component (renders useStellarPayment)",
    files: ["components/SendForm.tsx"],
    dependsOn: ["payments"],
    npmDependencies: [],
    kind: "component",
  },
  "transaction-list": {
    id: "transaction-list",
    description: "TransactionList component (renders useTransactionHistory)",
    files: ["components/TransactionList.tsx"],
    dependsOn: ["wallet", "history"],
    npmDependencies: [],
    kind: "component",
  },
  components: {
    id: "components",
    description: "All Nextellar UI components and the hooks they render",
    // No files of its own: the umbrella exists so `nextellar add components`
    // pulls every component feature (and transitively their hooks) at once.
    files: [],
    dependsOn: [
      "wallet",
      "network-switcher",
      "balance-display",
      "send-form",
      "transaction-list",
    ],
    npmDependencies: [],
    kind: "component",
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
 * Returns feature definitions for listing (id, description, kind).
 */
export function listFeatures(): {
  id: string;
  description: string;
  kind: FeatureKind;
}[] {
  return getFeatureIds().map((id) => {
    const f = FEATURES[id];
    return { id, description: f.description, kind: f.kind ?? "hook" };
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
