# Network and Environment Configuration Guide

Nextellar apps talk to the Stellar network through two endpoints — **Horizon**
(for account/balance/transaction data) and **Soroban RPC** (for smart-contract
calls) — plus a **network passphrase** that must match the chain you are
talking to. This guide covers the environment variables that configure them,
how to set up testnet vs. mainnet, and the in-app `NetworkSwitcher` component.

## Endpoints and the network passphrase

Nextellar ships with two built-in network profiles in
`src/config/networks.ts`:

| Key      | Horizon URL                       | Soroban URL                       | Passphrase                              |
| -------- | --------------------------------- | --------------------------------- | --------------------------------------- |
| `testnet`| `https://horizon-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015`     |
| `mainnet`| `https://horizon.stellar.org`     | `https://soroban.stellar.org`     | `Public Global Stellar Network ; September 2015` |

The **passphrase** is critical: signing or submitting a transaction with the
wrong passphrase will fail or, worse, target the wrong network. Always keep the
passphrase in sync with the selected network.

## Environment variables

Set these in `.env.local` (or `.env`) at the project root. They are read by
`WalletProvider` when the app boots.

| Variable                     | Purpose                                                        | Default                                            |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_HORIZON_URL`    | Horizon REST endpoint used for balances/transactions.         | `https://horizon-testnet.stellar.org`              |
| `NEXT_PUBLIC_SOROBAN_URL`    | Soroban RPC endpoint used for contract calls.                 | `https://soroban-testnet.stellar.org`              |
| `NEXT_PUBLIC_NETWORK`        | Selects the network passphrase. `PUBLIC` → mainnet, anything else → testnet. | `TESTNET` (testnet)                  |

Example `.env.local` for **testnet**:

```env
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK=TESTNET
```

Example `.env.local` for **mainnet**:

```env
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_URL=https://soroban.stellar.org
NEXT_PUBLIC_NETWORK=PUBLIC
```

> `NEXT_PUBLIC_NETWORK` only switches the **passphrase**. If you point
> `NEXT_PUBLIC_HORIZON_URL`/`NEXT_PUBLIC_SOROBAN_URL` at mainnet endpoints while
> leaving the passphrase on testnet, contract calls and submissions will fail.
> Keep all three consistent.

### Custom endpoints at scaffold time

When you create a project you can bake custom endpoints in via flags, which are
substituted into the `{{HORIZON_URL}}` / `{{SOROBAN_URL}}` placeholders in the
generated `WalletProvider`:

```bash
npx nextellar my-app --horizon-url https://my-horizon.example.com --soroban-url https://my-soroban.example.com
```

These become the compiled-in defaults; you can still override them later with
the environment variables above.

## Testnet vs. mainnet workflow

1. **Develop on testnet.** Use `NEXT_PUBLIC_NETWORK=TESTNET` and the testnet
   endpoints. Fund accounts with [Stellar Lab](https://lab.stellar.org) or
   Friendbot so you can exercise balances, payments, and contract deploys for
   free.
2. **Switch to mainnet only when ready.** Set `NEXT_PUBLIC_NETWORK=PUBLIC` and
   the mainnet endpoints, redeploy, and use real funded accounts. Mainnet
   transactions cost real XLM.
3. **Never mix passphrases and endpoints.** See the warning above.

## The NetworkSwitcher component

`NetworkSwitcher` (in `src/components/NetworkSwitcher.tsx`) lets users flip
between the `testnet` and `mainnet` profiles at runtime from the UI.

- It reads the active network and the `switchNetwork` callback from
  `useWalletConfig()`.
- It renders a small pill with a status dot: **green** for testnet, **orange**
  for mainnet.
- On change it calls `switchNetwork(nextKey)`. Because balances and accounts are
  network-specific, switching **disconnects the wallet first** (with a confirm
  prompt if a wallet is connected) and persists the choice to `localStorage`
  under the `stellar_network` key.
- It renders `null` until mounted (avoids a hydration mismatch) and when no
  `WalletConfigContext` is available.

Example usage in a layout/header:

```tsx
import NetworkSwitcher from '@/components/NetworkSwitcher';

export default function Header() {
  return (
    <header>
      <NetworkSwitcher />
    </header>
  );
}
```

Switching networks updates the `activeNetworkKey`, which `WalletProvider` uses
to derive the active `horizonUrl`, `sorobanUrl`, and `network` (passphrase)
passed to every hook and contract call. No env change or rebuild is required to
toggle networks in the running app.

## Troubleshooting

- **"Invalid Horizon URL" / fetch errors** — verify `NEXT_PUBLIC_HORIZON_URL`
  points at a reachable Horizon instance and matches the chosen passphrase.
- **Transactions rejected by the network** — almost always a passphrase/endpoint
  mismatch. Confirm `NEXT_PUBLIC_NETWORK` matches your endpoints.
- **NetworkSwitcher does nothing** — ensure it is rendered inside a
  `WalletProvider` (which provides `WalletConfigContext`).

## See also

- [Deployment Guide](./deploy-guide.md)
- [Soroban Contracts Overlay Guide](./soroban-contracts-overlay-guide.md)
