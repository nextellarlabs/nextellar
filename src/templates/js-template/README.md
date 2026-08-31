# {{APP_NAME}}

This is a [Next.js 16](https://nextjs.org) project bootstrapped with [Nextellar](https://github.com/nextellarlabs/nextellar) — a Stellar blockchain dApp starter using **Tailwind CSS v4** and **JavaScript** (pure JS, no TypeScript).

> ✨ **Congratulations!** You've successfully created a Nextellar project. When you scaffolded this app, you saw our friendly success animation and ASCII logo — that's how we celebrate your new Stellar dApp journey!

---

## 🚀 Setup & Configuration

### 1. Environment Variables

Copy the example environment file to create your local environment:

```bash
cp .env.example .env.local
```

Configure the following variables in `.env.local`:

| Variable | Description | Default / Example |
|---|---|---|
| `NEXT_PUBLIC_HORIZON_URL` | Horizon RPC server URL | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK` | Active Stellar network | `TESTNET` or `PUBLIC` |
| `NEXT_PUBLIC_WALLETS` | Comma-separated supported wallet IDs | `freighter,albedo,lobstr,xbull,hana` |
| `NEXT_PUBLIC_APP_NAME` | Display name of your dApp | `{{APP_NAME}}` |
| `NEXT_PUBLIC_CONTRACT_ID` | Optional Soroban contract ID | Deployed contract ID (`C...`) |

### 2. Network Configuration

Pre-configured networks live in `src/config/networks.js`. The default active network is driven by `NEXT_PUBLIC_NETWORK`:

```javascript
import { NETWORKS } from "@/config/networks";

// Access network settings:
const testnet = NETWORKS.testnet;
console.log(testnet.horizonUrl, testnet.networkPassphrase);
```

### 3. Wallet Setup

1. **Install Freighter Wallet**: Install the [Freighter](https://www.freighter.app/) browser extension.
2. **Create Testnet Account**: Generate a test account via the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator).
3. **Fund with Friendbot**: Request free testnet XLM via Friendbot.

---

## 🎨 UI Components

The template provides lightweight, accessible UI components ready to use in your pages.

### `WalletConnectButton`

Multi-wallet connection trigger matching the primary dApp theme. Displays active wallet name and status, automatically handling connection and disconnection.

**Props:**
- `theme` (`'light' | 'dark'`, default `'light'`): Visual theme for the button.

**Usage:**

```jsx
import WalletConnectButton from "@/components/WalletConnectButton";

export default function Header() {
  return (
    <header className="flex items-center justify-between p-4 border-b">
      <h1 className="text-xl font-bold">My Stellar dApp</h1>
      <WalletConnectButton theme="light" />
    </header>
  );
}
```

### `NetworkSwitcher`

A dropdown allowing users to switch between Stellar `Testnet` and `Mainnet` on the fly. Confirms before switching if a wallet is currently connected.

**Usage:**

```jsx
import NetworkSwitcher from "@/components/NetworkSwitcher";

export default function Navigation() {
  return (
    <nav className="flex items-center gap-4">
      <NetworkSwitcher />
    </nav>
  );
}
```

### `ErrorBoundary`

Class-based error boundary that catches runtime errors in child component trees, displaying a user-friendly error UI with a retry action and collapsible technical details.

**Usage:**

```jsx
import ErrorBoundary from "@/components/ErrorBoundary";
import MyFeature from "@/components/MyFeature";

export default function Page() {
  return (
    <ErrorBoundary>
      <MyFeature />
    </ErrorBoundary>
  );
}
```

---

## 🪝 Hooks

The template includes an extensive set of custom React hooks for interacting with the Stellar blockchain and Soroban smart contracts.

### `useStellarWallet`

Manages wallet state, connecting/disconnecting supported wallets, and accessing connected accounts.

```jsx
import { useStellarWallet } from "@/hooks/useStellarWallet";

export default function WalletStatus() {
  const {
    connected,
    publicKey,
    walletName,
    connect,
    disconnect,
    accounts,
  } = useStellarWallet();

  if (!connected) {
    return <button onClick={() => connect()}>Connect Wallet</button>;
  }

  return (
    <div>
      <p>Wallet: {walletName}</p>
      <p>Public Key: {publicKey}</p>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}
```

### `useStellarBalances`

Fetches and tracks native XLM and asset balances for any Stellar public key with optional background polling.

```jsx
import { useStellarBalances } from "@/hooks/useStellarBalances";

export default function BalanceList({ publicKey }) {
  const { balances, loading, error, refresh } = useStellarBalances(publicKey, {
    pollIntervalMs: 10000, // Poll every 10s
  });

  if (loading) return <p>Loading balances...</p>;
  if (error) return <p>Failed to load balances: {error.message}</p>;

  return (
    <div>
      <h3>Account Balances</h3>
      <ul>
        {balances.map((b, idx) => (
          <li key={idx}>
            {b.asset_type === "native" ? "XLM" : b.asset_code}: {b.balance}
          </li>
        ))}
      </ul>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

### `useStellarPayment`

Builds payment transactions, creates unsigned XDR for external wallet signing, and submits signed payment transactions to Horizon.

```jsx
import { useState } from "react";
import { useStellarPayment } from "@/hooks/useStellarPayment";

export default function SendPayment({ fromAddress }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const { buildPaymentXDR, submitSignedXDR, loading, error } = useStellarPayment();

  const handlePay = async () => {
    try {
      const xdr = await buildPaymentXDR({
        from: fromAddress,
        to: recipient,
        amount,
        asset: "XLM",
        memo: "Nextellar payment",
      });
      // Sign `xdr` with your wallet, then submit:
      // const signed = await wallet.sign(xdr);
      // const res = await submitSignedXDR(signed);
    } catch (err) {
      console.error("Payment failed", err);
    }
  };

  return (
    <div>
      <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient address" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (XLM)" />
      <button onClick={handlePay} disabled={loading}>Send</button>
      {error && <p className="text-red-500">{error.message}</p>}
    </div>
  );
}
```

### `useTransactionHistory`

Fetches paginated operations or payment history for an account from Horizon with infinite loading support.

```jsx
import { useTransactionHistory } from "@/hooks/useTransactionHistory";

export default function History({ publicKey }) {
  const { items, loading, error, fetchNextPage, hasMore, refresh } = useTransactionHistory(publicKey, {
    pageSize: 15,
    type: "payments", // 'payments' or 'operations'
  });

  return (
    <div>
      <h2>Transaction History</h2>
      {items.map((tx) => (
        <div key={tx.id} className="p-2 border-b">
          <p>Type: {tx.type}</p>
          <p>Created: {tx.created_at}</p>
        </div>
      ))}
      {hasMore && (
        <button onClick={fetchNextPage} disabled={loading}>
          {loading ? "Loading..." : "Load More"}
        </button>
      )}
    </div>
  );
}
```

### `useTrustlines`

Inspects existing trustlines for an account and builds change-trust transaction XDRs to add or remove assets.

```jsx
import { useTrustlines } from "@/hooks/useTrustlines";

export default function Trustlines({ publicKey }) {
  const { trustlines, buildChangeTrustXDR, loading } = useTrustlines(publicKey);

  const handleAddUSDC = async () => {
    const xdr = await buildChangeTrustXDR({
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      limit: "100000",
    });
    // Sign XDR with wallet and submit
  };

  return (
    <div>
      <h3>Current Trustlines</h3>
      {trustlines.map((tl, i) => (
        <p key={i}>{tl.asset_code} (Limit: {tl.limit})</p>
      ))}
      <button onClick={handleAddUSDC} disabled={loading}>Add USDC Trustline</button>
    </div>
  );
}
```

### `useOfferBook`

Queries Horizon's decentralized exchange (DEX) orderbook for bids and asks between two assets.

```jsx
import { useOfferBook } from "@/hooks/useOfferBook";

export default function OrderBook() {
  const buying = "XLM";
  const selling = {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  };

  const { bids, asks, loading } = useOfferBook(buying, selling, { limit: 10 });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <h4>Bids</h4>
        {bids.map((b, i) => <p key={i}>{b.amount} @ {b.price}</p>)}
      </div>
      <div>
        <h4>Asks</h4>
        {asks.map((a, i) => <p key={i}>{a.amount} @ {a.price}</p>)}
      </div>
    </div>
  );
}
```

### `useSorobanContract`

Provides low-level interaction with Soroban smart contracts, including simulated calls and invoke transaction building.

```jsx
import { useSorobanContract } from "@/hooks/useSorobanContract";

export default function ContractReader({ contractId }) {
  const { callFunction, loading, error } = useSorobanContract({
    contractId,
    network: "TESTNET",
  });

  const handleRead = async () => {
    try {
      const result = await callFunction("get_count", []);
      console.log("Count result:", result);
    } catch (err) {
      console.error("Contract call failed:", err);
    }
  };

  return (
    <div>
      <button onClick={handleRead} disabled={loading}>Read Contract State</button>
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

### `useSorobanEvents`

Polls for smart contract events with automatic reconnection, exponential backoff, and optional topic filtering.

```jsx
import { useSorobanEvents } from "@/hooks/useSorobanEvents";

export default function EventFeed({ contractId }) {
  const { events, loading, error } = useSorobanEvents({
    contractId,
    pollIntervalMs: 5000,
  });

  return (
    <div>
      <h3>Contract Events</h3>
      {events.map((evt) => (
        <div key={evt.id} className="text-sm">
          <p>Ledger: {evt.ledger}</p>
          <p>Value: {evt.value}</p>
        </div>
      ))}
    </div>
  );
}
```

---

## 🛠️ Development vs Production

**Development Mode:**
- Use testnet Horizon and Soroban RPCs (`https://horizon-testnet.stellar.org`, `https://soroban-testnet.stellar.org`).
- Includes test helper methods for quick iterations.
- Never use real secret keys in frontend code.

**Production Mode:**
- Set `NEXT_PUBLIC_NETWORK=PUBLIC` and point to production Horizon/RPC endpoints.
- Ensure all transactions are signed via user wallets (e.g. Freighter, Albedo, Lobstr).
- Provide meaningful user feedback and error boundaries for network errors.

---

## 🏃 Getting Started

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Edit `src/app/page.jsx` to start building your dApp.
