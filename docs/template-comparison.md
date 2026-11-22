# Template Comparison Matrix

This document provides a comprehensive, automatically generated feature and artifact comparison across all Nextellar starters, including TypeScript and JavaScript variants.

> **Note:** This file is generated automatically from the template sources by `scripts/generate-template-comparison.mjs`. Do not edit manually; CI validates drift using the `--check` flag.

---

## 🚀 Templates Overview

| Template | Focus / Description | TypeScript | JavaScript | Contracts Pre-configured | Primary Use Case |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **`minimal`** | Bare starter: wallet connection only, no extra UI | ✅ | ✅ | ❌ | Lightweight dApps, custom design systems, or embedded wallet micro-frontends |
| **`default`** | Full starter: wallet provider, network switcher, balances, payments & tx history | ✅ | ✅ | ❌ | General-purpose Stellar dApps, wallet dashboards, anchor payments |
| **`defi`** | DeFi starter: swaps, path payments, liquidity pool and Soroban counter | ✅ | ✅ | ❌ | DEX integrations, automated market making, liquidity pools, token swaps |
| **`full`** | Everything: default suite + defi demo with Soroban smart contracts pre-configured | ✅ | ✅ | ✅ | End-to-end fullstack Soroban smart contract applications with frontend & backend contracts crate |

---

## 🧩 Components Matrix

The table below details every React component included across each template. `TS` indicates availability in TypeScript (`.tsx`), and `JS` indicates availability in JavaScript (`.jsx`).

| Component | `minimal` (TS / JS) | `default` (TS / JS) | `defi` (TS / JS) | `full` (TS / JS) |
| :--- | :---: | :---: | :---: | :---: |
| `AccountSwitcher` | ✅ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `BalanceDisplay` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `ContractCallForm` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `ContractCallPreview` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `CopyButton` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `CounterDemo` | ❌ / ❌ | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ |
| `EmptyState` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `ErrorBoundary` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `LoadingBoundary` | ✅ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `NetworkMismatchBanner` | ✅ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `NetworkSwitcher` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `ReceiveForm` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `SendForm` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `Sep24InteractiveFrame` | ❌ / ❌ | ✅ / ✅ | ✅ / ❌ | ✅ / ✅ |
| `Skeleton` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `SkeletonList` | ❌ / ❌ | ❌ / ✅ | ❌ / ❌ | ❌ / ✅ |
| `SwapForm` | ❌ / ❌ | ❌ / ❌ | ✅ / ❌ | ❌ / ❌ |
| `ThemeToggle` | ✅ / ❌ | ✅ / ✅ | ✅ / ❌ | ✅ / ✅ |
| `TransactionList` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `TransactionStatusBadge` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `WalletConnectButton` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |

---

## 🪝 Hooks Matrix

The table below lists every custom React hook available in each template's `src/hooks/` directory.

| Hook | `minimal` (TS / JS) | `default` (TS / JS) | `defi` (TS / JS) | `full` (TS / JS) |
| :--- | :---: | :---: | :---: | :---: |
| `useClipboard` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useContractDeploy` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useContractEventHistory` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useContractUpgrade` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useFederationLookup` | ❌ / ❌ | ✅ / ❌ | ❌ / ❌ | ✅ / ❌ |
| `useHorizonStreaming` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useMultisigTransaction` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useOfferBook` | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `usePathPayment` | ❌ / ❌ | ❌ / ❌ | ✅ / ❌ | ❌ / ❌ |
| `usePrefersReducedMotion` | ✅ / ❌ | ✅ / ✅ | ✅ / ❌ | ✅ / ✅ |
| `useSep24Interactive` | ❌ / ❌ | ✅ / ✅ | ❌ / ❌ | ✅ / ✅ |
| `useSep30Recovery` | ❌ / ❌ | ✅ / ✅ | ✅ / ❌ | ✅ / ✅ |
| `useSep38Quote` | ❌ / ❌ | ✅ / ✅ | ✅ / ❌ | ✅ / ✅ |
| `useSep6` | ❌ / ❌ | ✅ / ❌ | ❌ / ❌ | ✅ / ❌ |
| `useSorobanContract` | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useSorobanEvents` | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useStellarBalances` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useStellarPayment` | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useStellarWallet` | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useTransactionHistory` | ✅ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| `useTrustlines` | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |

---

## 🛠️ Feature Comparison

| Capability | `minimal` | `default` | `defi` | `full` |
| :--- | :---: | :---: | :---: | :---: |
| **Stellar Wallets Kit (Freighter, Albedo, xBull)** | ✅ | ✅ | ✅ | ✅ |
| **Network Switcher (Testnet / Mainnet / Custom)** | ✅ | ✅ | ✅ | ✅ |
| **Horizon Balance & Trustlines** | ✅ | ✅ | ✅ | ✅ |
| **Transaction History Feed** | ✅ | ✅ | ✅ | ✅ |
| **Send & Receive Payment Flows** | ✅ | ✅ | ✅ | ✅ |
| **DeFi Token Swaps & Path Payments** | ❌ | ❌ | ✅ | ❌ |
| **SEP-24 Interactive Anchor Webview** | ❌ | ✅ | ✅ | ✅ |
| **SEP-30 Key Recovery** | ❌ | ✅ | ✅ | ✅ |
| **SEP-38 Anchor Quotes** | ❌ | ✅ | ✅ | ✅ |
| **Soroban Smart Contracts Overlay (`contracts/`)** | Opt-in (`--with-contracts`) | Opt-in (`--with-contracts`) | Opt-in (`--with-contracts`) | **Included by Default** |
| **Soroban Counter Demo Component** | ❌ | ❌ | ✅ | ✅ |
| **Tailwind CSS & Dark Theme Support** | ✅ | ✅ | ✅ | ✅ |
| **Storybook Stories Included** | ✅ | ✅ | ✅ | ✅ |

---

## 🔄 Keeping This Document Current

To update this document after modifying templates, run:

```bash
node scripts/generate-template-comparison.mjs
```

To verify in CI that the documentation is in sync with the codebase:

```bash
node scripts/generate-template-comparison.mjs --check
```
<!-- Generated by scripts/generate-template-comparison.mjs. Do not edit manually. -->
