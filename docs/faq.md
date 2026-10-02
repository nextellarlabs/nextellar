# Frequently Asked Questions (FAQ)

Welcome to the Nextellar FAQ. Here you will find answers to the most common questions about setting up, developing, and deploying Stellar and Soroban dApps with Nextellar.

---

### 1. Which template should I choose when running `create-nextellar-dapp`?
- **Default (`nextjs-ts`)**: Full-featured dApp with Tailwind CSS, wallet connectors, Horizon payment hooks, and transaction history.
- **DeFi (`defi`)**: Optimized for DEX AMM pools, liquidity management, orderbooks, and token swaps.
- **Contracts (`contracts-template`)**: Scaffolded with Rust Soroban smart contracts, bindings generation, and local sandbox scripts.
- **Minimal (`minimal`)**: Bare-bones setup for maximum customization and minimal bundle footprint.

---

### 2. Why is my Freighter / Stellar wallet not connecting?
- Ensure your browser extension is unlocked.
- Verify that your wallet network setting matches your application configuration (`TESTNET` vs `PUBLIC`).
- Check if another wallet extension (e.g. MetaMask / Albedo) is overriding `window.freighter`.
- Ensure your site is served over `https://` or `http://localhost`.

---

### 3. Why does `nextellar doctor` report missing dependencies?
`nextellar doctor` verifies that Node.js (>=18), Rust, `cargo`, and the `stellar-cli` are correctly installed and available on your system `$PATH`. Run `rustup update` and `cargo install --locked stellar-cli` to install missing CLI tools.

---

### 4. How do I test with testnet lumens (XLM)?
Visit the [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) or use the built-in testnet faucet script in `scripts/fund-testnet.sh` to fund any new Ed25519 public key with 10,000 test XLM.

---

### 5. What are Fee-Bump transactions and when should I use them?
Fee-Bump transactions allow an external sponsor account to pay transaction fees on behalf of the user. Nextellar's `SendForm` and `useStellarPayment` hook support `buildFeeBumpPaymentXDR` so users with zero XLM balance can still submit operations if sponsored.

---

### 6. How do I add custom trustlines for non-native assets?
Use the `useTrustlines` hook or call `Operation.changeTrust({ asset: new Asset(code, issuer) })`. Once established, non-native tokens appear automatically in `BalanceDisplay` and `SendForm` asset selectors.

---

### 7. How do I deploy and invoke Soroban smart contracts locally?
Start a local standalone node using `docker run --rm -it -p 8000:8000 stellar/quickstart --standalone --enable-soroban-rpc`. Then build and deploy using `stellar contract build` and `stellar contract deploy`.

---

### 8. How do I export my transaction history to CSV?
The `TransactionList` component includes a built-in "Export CSV" action that generates an RFC-4180 compliant CSV containing transaction IDs, timestamps, amounts, assets, and counterparties for accounting and tax reconciliation.

---

### 9. Why does my transaction fail with `tx_bad_seq`?
A sequence number mismatch occurs when concurrent transactions are submitted from the same account. Use Nextellar's sequence queuing utilities in `useStellarPayment` or refresh the account state before signing.

---

### 10. How do I configure production deployments on Vercel or Netlify?
Set `NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC` and `NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org` in your environment variables. Ensure CSP headers in `next.config.js` whitelist your Horizon and Soroban RPC endpoints.
