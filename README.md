# Nextellar

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
- **Smart contracts overlay** (`--with-contracts`)
  - Soroban Rust contracts scaffolded alongside the frontend
- **Opinionated stack**
  - Next.js 16 (App Router) + TypeScript
  - Tailwind CSS v4 (inline shadcn/ui-inspired components)
  - ESLint, Prettier, Jest + React Testing Library

> 🗺️ Additional components (`BalanceDisplay`, `SendForm`, `TransactionList`, and more) are installable via `nextellar add <feature>`. See the [Roadmap](#roadmap) for planned components not yet available.

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
  -v, --version                output the current version
  -t, --typescript             generate a TypeScript project (default)
  -j, --javascript             generate a JavaScript project
  --template <name>            project template to use (default, minimal, defi)
  --horizon-url <url>          custom Horizon endpoint
  --soroban-url <url>          custom Soroban RPC endpoint
  -w, --wallets <list>         comma-separated wallet adapters (freighter, xbull)
  -d, --defaults               skip prompts and use defaults
  --skip-install               skip dependency installation after scaffolding
  --package-manager <manager>  choose package manager (npm, yarn, pnpm)
  -c, --with-contracts         scaffold Soroban smart contracts alongside the frontend
  --force                      overwrite existing directory
  --install-timeout <ms>       timeout in ms for package install (default: 1200000 / 20 minutes)
  --no-telemetry               disable telemetry for this invocation
  -h, --help                   display help for command
```

### Subcommands

| Command | Description |
| --- | --- |
| `nextellar add [feature]` | Add a Stellar feature to an existing project (`--list` to see all, `--force` to overwrite, `--skip-install`, `--package-manager`) |
| `nextellar doctor` | Run environment diagnostics (`--json` for CI) |
| `nextellar upgrade` | Upgrade an existing project to the latest template (`--dry-run` to preview, `--yes` to skip prompts) |
| `nextellar deploy` | Validate and prepare a deployment bundle for Nextellar Cloud (`--dry-run` to preview) |
| `nextellar telemetry <status\|enable\|disable>` | Manage anonymous telemetry settings |

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

---

## 🤝 Contributing

We welcome your help! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Issue & PR workflow
- Branch naming conventions
- Testing & linting guidelines

---

## 📜 License

MIT © 2025 [Nextellar Labs](https://github.com/nextellarlabs)
