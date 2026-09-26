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
  - Wallet-adapter plugin system (Freighter, Albedo, Lobstr, XBull, and more)
- **React Hooks** (8 shipped)
  - `useStellarWallet()`, `useStellarBalances()`, `useStellarPayment()`, `useTransactionHistory()`, `useTrustlines()`, `useOfferBook()`, `useSorobanContract()`, `useSorobanEvents()`
- **UI Components** (2 shipped)
  - `<WalletConnectButton>`, `<NetworkSwitcher>`
  - Additional components (`BalanceDisplay`, `SendForm`, `TransactionList`, and more) are installable via `nextellar add <feature>` — see the [Roadmap](#roadmap) for planned components not yet available
- **Smart contracts overlay** (`--with-contracts`)
  - Soroban Rust contracts scaffolded alongside the frontend
- **Opinionated stack**
  - Next.js 16 (App Router) + TypeScript
  - Tailwind CSS v4 (inline shadcn/ui-inspired components)
  - ESLint, Prettier, Jest + React Testing Library
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
npm run dev
```

_Or install globally:_

```bash
npm install -g nextellar
nextellar my-app
```

---

## ⚙️ CLI Usage

```
Usage: nextellar [options] [command] <project-name>

CLI to scaffold a Next.js + Stellar starter

Arguments:
  project-name                 name of the new Nextellar project

Options:
  -v, --version                 output the current version
  -t, --typescript               generate a TypeScript project (default)
  -j, --javascript                generate a JavaScript project
  --template <name>              project template to use (default, minimal, defi)
  --horizon-url <url>            custom Horizon endpoint
  --soroban-url <url>            custom Soroban RPC endpoint
  -w, --wallets <list>           comma-separated wallet adapters (freighter, xbull)
  -d, --defaults                  skip prompts and use defaults
  -y, --yes                       alias for --defaults: skip prompts and use defaults
  --skip-install                  skip dependency installation after scaffolding
  --package-manager <manager>    choose package manager (npm, yarn, pnpm, bun)
  -c, --with-contracts            scaffold Soroban smart contracts alongside the frontend
  --force                         overwrite existing directory
  --no-git                        skip initializing a git repository in the new project (defaults to on)
  --git-init                      explicitly initialize a git repository in the new project
  --install-timeout <ms>         timeout in ms for package install (default: 1200000 / 20 minutes)
  --no-telemetry                  disable telemetry for this invocation
  -h, --help                      display help for command
```

### Subcommands

| Command | Description |
| --- | --- |
| `nextellar add [feature]` | Add a Stellar feature to an existing project (`--list` to see all, `--force` to overwrite, `--skip-install`, `--package-manager`) |
| `nextellar doctor` | Run environment diagnostics (`--json` for CI, `--fix` to auto-remediate safe issues) |
| `nextellar upgrade` | Upgrade an existing project to the latest template (`--dry-run` to preview, `--check` for a changelog preview, `--yes` to skip prompts) |
| `nextellar deploy` | Validate and prepare a deployment bundle for Nextellar Cloud (`--dry-run` to preview) |
| `nextellar clean` | Remove `.nextellar/` build artifacts |
| `nextellar telemetry <status\|enable\|disable>` | Manage anonymous telemetry settings |

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
│   ├── hooks/                  # Custom Stellar hooks (useStellarWallet, etc)
│   └── lib/                    # Core logic and SDK initializations
├── next.config.ts              # Next.js configuration
├── tsconfig.json               # TypeScript configuration
├── postcss.config.mjs          # PostCSS / Tailwind CSS v4
├── eslint.config.mjs           # ESLint configuration
├── package.json                # Project dependencies
└── README.md                   # You are here!
```

---

## 🗺️ Roadmap

The following components and tools are planned but **not yet included** in scaffolded projects. Track progress or contribute via their issue links:

| Feature | Status | Issue |
| --- | --- | --- |
| `<BalanceDisplay>` component | Installable via `nextellar add balance-display` | — |
| `<SendForm>` component | Installable via `nextellar add send-form` | — |
| `<TransactionList>` component | Installable via `nextellar add transaction-list` | — |
| `<ReceiveForm>` component | Planned | — |
| `<TransactionStatusBadge>` component | Planned | — |
| Full `shadcn/ui` integration | Templates ship inline shadcn/ui-inspired components; full setup is manual | — |
| Storybook for component previews | Planned | — |
| GitHub Actions CI in generated apps | Planned (repo-level CI: [#679](https://github.com/nextellarlabs/nextellar/issues/679), [#680](https://github.com/nextellarlabs/nextellar/issues/680)) | — |

> 💡 Use `nextellar add --list` to see all currently installable features.

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

Doctor diagnostic & troubleshooting guide:  
🔗 [docs/troubleshooting.md](docs/troubleshooting.md)

Testing guide for generated apps (Storybook interaction tests, and adding Jest/Vitest if you need it):  
🔗 [docs/testing-guide.md](docs/testing-guide.md)

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
