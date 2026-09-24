# {{APP_NAME}}

This is a [Next.js 16](https://nextjs.org) project bootstrapped with [Nextellar](https://github.com/nextellarlabs/nextellar) — a specialized Stellar DeFi starter using **Tailwind CSS v4** and **JavaScript**.

> ✨ **Congratulations!** You've successfully created a Nextellar project. When you scaffolded this app, you saw our friendly success animation and ASCII logo — that's how we celebrate your new Stellar dApp journey!

---

## 🚀 Setup & Configuration

### 1. Environment Variables

Create your local environment file by copying `.env.example`:

```bash
cp .env.example .env.local
```

Configure your environment settings in `.env.local`:

| Variable | Description | Default / Example |
|---|---|---|
| `NEXT_PUBLIC_HORIZON_URL` | Horizon server URL | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_URL` | Soroban RPC server URL | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK` | Target Stellar network | `TESTNET` or `PUBLIC` |
| `NEXT_PUBLIC_WALLETS` | Supported wallet providers | `freighter,albedo,lobstr` |
| `NEXT_PUBLIC_APP_NAME` | Display name of the application | `{{APP_NAME}}` |
| `NEXT_PUBLIC_CONTRACT_ID` | Optional deployed contract ID | Contract StrKey (`C...`) |

### 2. Wallet & Testnet Setup

1. **Install Freighter**: Download and install the [Freighter browser extension](https://www.freighter.app/).
2. **Switch to Testnet**: Open Freighter settings and switch the active network to **Testnet**.
3. **Create & Fund Account**: Use the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator) to generate a testnet keypair and fund it using Friendbot.

---

## 🎨 UI Components

### `WalletConnectButton`

Clean, responsive connection button tailored for Stellar DeFi applications. Handles connecting to Freighter, displays shortened public keys or wallet names when active, and provides a disconnect mechanism.

**Props:**
- `theme` (`'light' | 'dark'`, default `'light'`): Visual theme style.

**Usage:**

```jsx
import WalletConnectButton from "@/components/WalletConnectButton";

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 bg-gray-900 text-white">
      <div className="text-lg font-bold">Stellar DeFi Swap</div>
      <WalletConnectButton theme="dark" />
    </nav>
  );
}
```

### `ErrorBoundary`

Catches unexpected runtime errors across DeFi workflows (e.g. malformed transaction responses or unexpected contract failures) and presents a clean recovery interface with error details.

**Usage:**

```jsx
import ErrorBoundary from "@/components/ErrorBoundary";
import SwapInterface from "@/components/SwapInterface";

export default function TradePage() {
  return (
    <ErrorBoundary>
      <SwapInterface />
    </ErrorBoundary>
  );
}
```

---

## 🪝 DeFi Hooks

### `useStellarWallet`

Access the user's active wallet connection state and trigger connect/disconnect flows.

```jsx
import { useStellarWallet } from "@/hooks/useStellarWallet";

export default function WalletInfo() {
  const { connected, publicKey, walletName, connect, disconnect } = useStellarWallet();

  if (!connected) {
    return <button onClick={() => connect()}>Connect Wallet</button>;
  }

  return (
    <div>
      <p>Connected Wallet: {walletName}</p>
      <p>Account: {publicKey}</p>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}
```

### `useStellarBalances`

Fetches real-time native XLM and token balances for an account, with support for automatic interval polling to keep DeFi dashboards up to date.

```jsx
import { useStellarBalances } from "@/hooks/useStellarBalances";

export default function Balances({ address }) {
  const { balances, loading, error, refresh } = useStellarBalances(address, {
    pollIntervalMs: 8000,
  });

  if (loading) return <div>Fetching balances...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div className="space-y-2">
      <h3>Portfolio</h3>
      {balances.map((b, i) => (
        <div key={i} className="flex justify-between border-b py-1">
          <span>{b.asset_type === "native" ? "XLM" : b.asset_code}</span>
          <span>{b.balance}</span>
        </div>
      ))}
      <button onClick={refresh} className="text-sm text-blue-500">Refresh</button>
    </div>
  );
}
```

### `useStellarPayment`

Utility hook to construct unsigned payment transactions for wallet signing, submit signed transactions to Horizon, or run development payment tests.

```jsx
import { useState } from "react";
import { useStellarPayment } from "@/hooks/useStellarPayment";

export default function TransferForm({ userAddress }) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const { buildPaymentXDR, submitSignedXDR, loading } = useStellarPayment();

  const onTransfer = async () => {
    const xdr = await buildPaymentXDR({
      from: userAddress,
      to: destination,
      amount,
      asset: "XLM",
      memo: "DeFi Transfer",
    });
    // Sign XDR with Freighter and pass to submitSignedXDR(signedXDR)
  };

  return (
    <div>
      <input placeholder="Recipient G..." value={destination} onChange={(e) => setDestination(e.target.value)} />
      <input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button onClick={onTransfer} disabled={loading}>Transfer</button>
    </div>
  );
}
```

### `useTrustlines`

Inspects trustlines on the connected account and generates change-trust transaction XDRs to establish trust with tokens (e.g. USDC, EURC).

```jsx
import { useTrustlines } from "@/hooks/useTrustlines";

export default function TrustlineManager({ account }) {
  const { trustlines, buildChangeTrustXDR, loading } = useTrustlines(account);

  const enableUSDC = async () => {
    const xdr = await buildChangeTrustXDR({
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      limit: "500000",
    });
    // Sign and submit transaction
  };

  return (
    <div>
      <h4>Active Trustlines</h4>
      {trustlines.map((tl, index) => (
        <p key={index}>{tl.asset_code} — Limit: {tl.limit}</p>
      ))}
      <button onClick={enableUSDC} disabled={loading}>Add USDC Trustline</button>
    </div>
  );
}
```

### `useOfferBook`

Reads live orderbook bids and asks from Horizon's decentralized exchange for any asset trading pair.

```jsx
import { useOfferBook } from "@/hooks/useOfferBook";

export default function MarketDepth() {
  const buying = "XLM";
  const selling = {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  };

  const { bids, asks, loading, error } = useOfferBook(buying, selling, { limit: 5 });

  if (loading) return <div>Loading orderbook...</div>;
  if (error) return <div>Error loading book: {error.message}</div>;

  return (
    <div className="flex gap-8">
      <div>
        <h5 className="font-semibold text-green-500">Bids</h5>
        {bids.map((bid, i) => (
          <p key={i}>{bid.amount} @ {bid.price}</p>
        ))}
      </div>
      <div>
        <h5 className="font-semibold text-red-500">Asks</h5>
        {asks.map((ask, i) => (
          <p key={i}>{ask.amount} @ {ask.price}</p>
        ))}
      </div>
    </div>
  );
}
```

---

## ⚠️ Development vs Production

**Development Mode:**
- Point `.env.local` to Stellar Testnet Horizon (`https://horizon-testnet.stellar.org`).
- Test wallet interactions using funded testnet accounts.
- Never commit secret keys or seed phrases to version control.

**Production Mode:**
- Set `NEXT_PUBLIC_NETWORK=PUBLIC` and use high-availability Horizon endpoints.
- Ensure all DeFi contract and payment actions are confirmed and signed via external hardware or extension wallets.
- Always validate input amounts and asset trustlines before transaction construction.

---

## 🏃 Getting Started

Run the local development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to view your DeFi application. Edit `src/app/page.jsx` to begin customizing your application.
