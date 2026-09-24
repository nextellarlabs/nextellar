# React Hooks Reference

This document provides a reference for all the React hooks shipped with Nextellar for building Stellar and Soroban applications. 

## Wallet Hooks

### `useWallet()`

Provides access to the current wallet connection state and actions.

**Signature:**
```typescript
function useWallet(): WalletContextState
```

**Returns:**
An object containing:
- `connected` (boolean): True if a wallet is currently connected.
- `publicKey` (string | undefined): The public key of the connected wallet.
- `walletName` (string | undefined): The name of the connected wallet.
- `connect` (function): Function to initiate a connection.
- `disconnect` (function): Function to disconnect the current wallet.

**Example:**
```tsx
import { useWallet } from 'nextellar/contexts';

function MyComponent() {
  const { connected, publicKey, connect, disconnect } = useWallet();

  if (connected) {
    return (
      <div>
        <p>Connected as: {publicKey}</p>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return <button onClick={connect}>Connect Wallet</button>;
}
```

---

## Balance Hooks

### `useStellarBalances(publicKey)`

Fetches and manages balances for a specific Stellar account.

**Signature:**
```typescript
function useStellarBalances(publicKey?: string): { balances: Balance[], loading: boolean, error: Error | null, refresh: () => void }
```

**Returns:**
An object containing:
- `balances` (array): Array of balance objects (asset_type, balance, etc.).
- `loading` (boolean): True while balances are being fetched.
- `error` (Error | null): Any error encountered during fetching.
- `refresh` (function): Function to manually trigger a balance refresh.

**Example:**
```tsx
import { useStellarBalances } from 'nextellar/hooks';

function BalanceDisplay({ publicKey }) {
  const { balances, loading, error } = useStellarBalances(publicKey);

  if (loading) return <p>Loading balances...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <ul>
      {balances.map((b) => (
        <li key={b.asset_code || 'XLM'}>
          {b.balance} {b.asset_code || 'XLM'}
        </li>
      ))}
    </ul>
  );
}
```

---

## Payment Hooks

### `useStellarPayment()`

Provides functions to construct and submit Stellar payment transactions.

**Signature:**
```typescript
function useStellarPayment(): { 
  sendPayment: (params: PaymentParams) => Promise<TransactionResult>, 
  loading: boolean, 
  error: Error | null 
}
```

**Returns:**
An object containing:
- `sendPayment` (function): Function that takes payment parameters and submits a transaction.
- `loading` (boolean): True while the payment is being processed.
- `error` (Error | null): Any error encountered during the transaction.

**Example:**
```tsx
import { useStellarPayment } from 'nextellar/hooks';

function PaymentForm() {
  const { sendPayment, loading } = useStellarPayment();

  const handleSend = async () => {
    await sendPayment({
      destination: 'GABC...',
      amount: '10',
      assetCode: 'XLM'
    });
  };

  return (
    <button onClick={handleSend} disabled={loading}>
      {loading ? 'Sending...' : 'Send 10 XLM'}
    </button>
  );
}
```

---

## History Hooks

### `useTransactionHistory(publicKey)`

Retrieves the transaction history for a specified account.

**Signature:**
```typescript
function useTransactionHistory(publicKey?: string, limit?: number): { history: Transaction[], loading: boolean, error: Error | null }
```

**Returns:**
An object containing:
- `history` (array): Array of transaction records.
- `loading` (boolean): True while fetching history.
- `error` (Error | null): Any error encountered during fetching.

**Example:**
```tsx
import { useTransactionHistory } from 'nextellar/hooks';

function History({ publicKey }) {
  const { history, loading } = useTransactionHistory(publicKey, 5);

  if (loading) return <p>Loading history...</p>;

  return (
    <ul>
      {history.map((tx) => (
        <li key={tx.id}>Tx: {tx.id} - Hash: {tx.hash}</li>
      ))}
    </ul>
  );
}
```

---

## Trustline Hooks

### `useTrustlines()`

Provides functions for checking and establishing trustlines for Stellar assets.

**Signature:**
```typescript
function useTrustlines(): { 
  addTrustline: (assetCode: string, issuer: string) => Promise<TransactionResult>, 
  loading: boolean, 
  error: Error | null 
}
```

**Returns:**
An object containing:
- `addTrustline` (function): Submits a transaction to establish a new trustline.
- `loading` (boolean): True while the transaction is processing.
- `error` (Error | null): Any error encountered.

**Example:**
```tsx
import { useTrustlines } from 'nextellar/hooks';

function AddTrustline() {
  const { addTrustline, loading } = useTrustlines();

  const handleAdd = () => {
    addTrustline('USDC', 'GABC...');
  };

  return (
    <button onClick={handleAdd} disabled={loading}>
      Add USDC Trustline
    </button>
  );
}
```

---

## Offer Book Hooks

### `useOfferBook(selling, buying)`

Fetches the current order book for a given trading pair.

**Signature:**
```typescript
function useOfferBook(sellingAsset: Asset, buyingAsset: Asset): { 
  offers: { bids: Offer[], asks: Offer[] }, 
  loading: boolean, 
  error: Error | null 
}
```

**Returns:**
An object containing:
- `offers` (object): Contains arrays of `bids` and `asks`.
- `loading` (boolean): True while fetching.
- `error` (Error | null): Any error encountered.

**Example:**
```tsx
import { useOfferBook } from 'nextellar/hooks';

function OrderBook({ selling, buying }) {
  const { offers, loading } = useOfferBook(selling, buying);

  if (loading) return <p>Loading offers...</p>;

  return (
    <div>
      <h3>Bids</h3>
      {offers.bids.map(bid => <p key={bid.price}>{bid.amount} @ {bid.price}</p>)}
      <h3>Asks</h3>
      {offers.asks.map(ask => <p key={ask.price}>{ask.amount} @ {ask.price}</p>)}
    </div>
  );
}
```

---

## Soroban Hooks

### `useSorobanEvents(contractId)`

Listens for or fetches events emitted by a specific Soroban smart contract.

**Signature:**
```typescript
function useSorobanEvents(contractId: string, topics?: string[]): { 
  events: SorobanEvent[], 
  loading: boolean, 
  error: Error | null 
}
```

**Returns:**
An object containing:
- `events` (array): A list of Soroban events matching the contract.
- `loading` (boolean): True while fetching.
- `error` (Error | null): Any error encountered.

**Example:**
```tsx
import { useSorobanEvents } from 'nextellar/hooks';

function ContractEvents({ contractId }) {
  const { events, loading } = useSorobanEvents(contractId);

  if (loading) return <p>Listening for events...</p>;

  return (
    <ul>
      {events.map((evt, idx) => (
        <li key={idx}>Event Topic: {evt.topic}</li>
      ))}
    </ul>
  );
}
```
