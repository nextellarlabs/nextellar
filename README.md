# Nextellar

[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/nextellarlabs/nextellar/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/nextellarlabs/nextellar/actions/workflows/ci.yml)
[![Dependency Audit](https://img.shields.io/github/actions/workflow/status/nextellarlabs/nextellar/audit.yml?branch=main&label=Security%20Audit&style=flat-square)](https://github.com/nextellarlabs/nextellar/actions/workflows/audit.yml)
[![npm Version](https://img.shields.io/npm/v/nextellar.svg?style=flat-square)](https://www.npmjs.com/package/nextellar)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

Nextellar is a one-step CLI toolkit that bootstraps a production-ready Next.js + TypeScript application with built-in Stellar blockchain support. Scaffold a full-stack dApp starter—complete with wallet connection, payment hooks, smart-contract integration, UI components, and best-practice defaults—so you can focus on features, not setup.

---

## 🚀 Features

- **One-step scaffold**
  ```bash
  npx nextellar my-app
  ```
- **Built-in Stellar support**
  - Horizon & Soroban endpoints configured
  - Wallet-adapter plugin system (Freighter, XBull, Ledger, etc.)
- **React Hooks**
  - `useStellarAccount()`, `useStellarPayment()`, `useTrustlines()`, `useTransactionHistory()`, `useSorobanContract()`
- **UI Components**
  - `<WalletConnectButton>`, `<BalanceDisplay>`, `<SendForm>`, `<ReceiveForm>`, `<TransactionList>`, `<NetworkSwitcher>`, `<TransactionStatusBadge>`
- **Opinionated stack**
  - Next.js (v13+ App Router) + TypeScript
  - Tailwind CSS + shadcn/ui
  - ESLint, Prettier, Jest + React Testing Library
  - Storybook for component previews
  - GitHub Actions CI for linting, testing, and build
- **🔒 Security First**
  - Automated dependency auditing (daily)
  - Strict severity gates (fail on critical/high)
  - Dependabot auto-updates for security patches
  - CodeQL static analysis
  - See [SECURITY.md](SECURITY.md) for details

---

## 📦 Installation

_No global install required:_

```bash
npx nextellar my-app
cd my-app
npm install
npm run dev
```

_Or install globally:_

```bash
npm install -g nextellar
nextellar my-app
```

---

## ⚙️ CLI Usage

```bash
Usage: nextellar <project-name> [options]

Options:
  -t, --typescript         Generate a TypeScript project (default)
  -j, --javascript         Generate a JavaScript project
  --template <name>        Starter to scaffold (default, minimal, defi)
  --horizon-url <url>      Override default Horizon endpoint
  --soroban-url <url>      Override default Soroban RPC endpoint
  -w, --wallets <list>     Comma-separated list of wallet adapters
  -d, --defaults           Skip prompts and use defaults
  --skip-install           Skip dependency installation after scaffolding
  --package-manager <pm>   Choose package manager (npm, yarn, pnpm)
  --install-timeout <ms>   Timeout in ms for package install (default: 1200000 / 20 minutes)
  -v, --version            Show CLI version
  -h, --help               Show help text
```

---

## 🧩 Templates

`--template <name>` selects which starter to scaffold. It defaults to
`default` when omitted. Every template supports both TypeScript and JavaScript.

| Template  | Description                                                                    | TypeScript | JavaScript |
| --------- | ------------------------------------------------------------------------------ | :--------: | :--------: |
| `default` | Full starter: wallet provider, network switcher, balances, transaction history  |     ✅     |     ✅     |
| `minimal` | Bare starter: wallet connection only, no extra UI                               |     ✅     |     ✅     |
| `defi`    | DeFi starter: swap, liquidity pool and price-feed components                    |     ✅     |     ✅     |

```bash
npx nextellar my-app                          # default template, TypeScript
npx nextellar my-app --template minimal       # minimal starter
npx nextellar my-app --template minimal -j    # minimal starter, JavaScript
npx nextellar my-app --template defi -j       # DeFi starter, JavaScript
```

An unrecognised name fails before anything is written, and the error lists
every valid option:

```bash
$ npx nextellar my-app --template nope
Unknown template "nope". Available templates: default, minimal, defi.
```

> Soroban smart contracts are added with `--with-contracts`, not with
> `--template`. The two flags compose: `--template defi --with-contracts`.

---

## 📁 Project Structure

```bash
my-app/
├── public/                     # Static assets (logos, icons)
├── src/
│   ├── app/                    # Next.js App Router (Layouts & Pages)
│   ├── components/             # Reusable UI components (WalletButton, etc)
│   ├── contexts/               # React Contexts (WalletProvider)
│   ├── hooks/                  # Custom Stellar hooks (useStellarAccount, etc)
│   └── lib/                    # Core logic and SDK initializations
├── tailwind.config.ts          # Styling configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Project dependencies
└── README.md                   # You are here!
```

---

## 📖 Documentation

Full API reference, guides, and examples live at:  
🔗 https://docs.nextellar.dev

Telemetry and privacy details:  
🔗 [docs/telemetry.md](docs/telemetry.md)

Per-template bundle analysis and size budgets:  
🔗 [docs/bundle-budgets.md](docs/bundle-budgets.md)

Deployment bundle guide (`nextellar deploy`):  
🔗 [docs/deploy-guide.md](docs/deploy-guide.md)

Network and environment configuration (Horizon/Soroban, testnet/mainnet, NetworkSwitcher):  
🔗 [docs/network-environment-guide.md](docs/network-environment-guide.md)

Soroban contracts overlay guide (`--with-contracts`):  
🔗 [docs/soroban-contracts-overlay-guide.md](docs/soroban-contracts-overlay-guide.md)

---

## 🚀 Backend & Stellar Wave Routes

The Nextellar backend API and Stellar Wave contributor routes have been moved to a separate repository for clearer project governance and independent maintenance:

🔗 **[nextellarlabs/nextellar-backend](https://github.com/nextellarlabs/nextellar-backend)**

This repo contains:
- Express API server with authentication, payments, orders, and middleware
- ~150 route files from the Stellar Wave contributor program
- Full test suites and documentation

---

## 🤝 Contributing

We welcome your help! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Issue & PR workflow
- Branch naming conventions
- Testing & linting guidelines

---

## 📜 License

MIT © 2025 [Nextellar Labs](https://github.com/nextellarlabs)
