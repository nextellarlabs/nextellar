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
  --horizon-url <url>      Override default Horizon endpoint
  --soroban-url <url>      Override default Soroban RPC endpoint
  -w, --wallets <list>     Comma-separated list of wallet adapters
  -e, --example <name>     Scaffold with a named example (e.g. `payments-demo`)
  -d, --defaults           Skip prompts and use defaults
  -v, --version            Show CLI version
  -h, --help               Show help text
```

---

## 📁 Project Structure

```bash
my-app/
├── public/
│   └── favicon.ico
├── styles/
│   └── globals.css
├── src/
│   ├── app/                         # Next.js App Router
│   │   └── page.tsx                 # Home page with Nextellar UI
│   ├── lib/
│   │   ├── stellar-client.ts        # Horizon & network config
│   │   └── wallet-connect.ts        # Wallet adapter logic
│   ├── hooks/
│   │   ├── useStellarAccount.ts
│   │   ├── useStellarPayment.ts
│   │   └── useSorobanContract.ts
│   └── components/
│       ├── WalletConnectButton.tsx
│       ├── BalanceDisplay.tsx
│       └── SendForm.tsx
├── .env.example                    # ENV vars for Horizon & network
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── README.md                       # You are here!
```

---

## 📖 Documentation

Full API reference, guides, and examples live at:  
🔗 https://docs.nextellar.dev

---

## 🤝 Contributing

We welcome your help! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for:

- Issue & PR workflow  
- Branch naming conventions  
- Testing & linting guidelines  
---

## 📜 License

MIT © 2025 [Nextellar Labs](https://github.com/nextellarlabs)
