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

### `useStellarWallet(horizonUrl, network)`

A standalone wallet hook built directly on Stellar Wallets Kit (Freighter, Albedo, Lobstr, …). Unlike `useWallet()`, it does not need `WalletProvider` — each call owns its own connection state. The connection is persisted to `localStorage` and restored on mount if the kit still reports the same address.

**Signature:**
```typescript
function useStellarWallet(horizonUrl?: string, network?: string): StellarWalletState
```

**Parameters:**
- `horizonUrl` (string, optional): Horizon server used for balances and payment submission. Defaults to `'https://horizon-testnet.stellar.org'`. Read once on mount; later changes are ignored.
- `network` (string, optional): Network **passphrase** used to build and sign payments. Defaults to `Networks.TESTNET`.

**Returns:**
An object containing:
- `connected` (boolean): True once a wallet has been selected and its address read.
- `publicKey` (string | undefined): The connected account's address.
- `walletName` (string | undefined): The selected wallet's display name.
- `balances` (Balance[]): Raw Horizon balance lines (`balance`, `asset_type`, `asset_code?`, `asset_issuer?`). Empty for an unfunded account.
- `connect` (`() => Promise<void>`): Opens the Stellar Wallets Kit selection modal; state updates when the user picks a wallet. Rethrows if the kit fails.
- `disconnect` (`() => void`): Disconnects the kit, clears state and the persisted connection.
- `refreshBalances` (`() => Promise<void>`): Re-fetches balances for `publicKey`; a no-op while disconnected.
- `sendPayment` (`((opts: PaymentOptions) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>) | undefined`): Only defined while connected. Builds a payment (`to`, `amount`, optional `asset` — `'XLM'` or `{ code, issuer }` — and `memo`), signs it through the wallet, submits it to Horizon, refreshes balances and resolves with the Horizon response. Throws on failure.

**Example:**
```tsx
import { useStellarWallet } from '@/hooks/useStellarWallet';

function QuickPay() {
  const { connected, publicKey, balances, connect, sendPayment } = useStellarWallet();

  if (!connected) return <button onClick={() => connect()}>Connect Wallet</button>;

  const xlm = balances.find((b) => b.asset_type === 'native');

  const handlePay = async () => {
    const result = await sendPayment?.({
      to: 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT',
      amount: '5',
      memo: 'coffee',
    });
    console.log('Submitted:', result?.hash);
  };

  return (
    <div>
      <p>{publicKey} — {xlm?.balance ?? '0'} XLM</p>
      <button onClick={handlePay}>Send 5 XLM</button>
    </div>
  );
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

### `useSorobanContract(opts)`

Simulates, builds and (dev-only) submits calls to a Soroban smart contract, encoding plain JavaScript arguments to XDR `ScVal`s and decoding return values back. No provider is required.

**Signature:**
```typescript
function useSorobanContract(opts: SorobanContractOptions): SorobanContractReturn
```

**Parameters:**
- `opts.contractId` (string): StrKey contract address (`C…`, 56 characters). Validated on every render — an invalid or empty ID (e.g. an unset env var) **throws during render**.
- `opts.sorobanRpc` (string, optional): Soroban RPC URL. Defaults to `'https://soroban-testnet.stellar.org'`.
- `opts.network` (`'TESTNET' | 'PUBLIC'`, optional): Selects the network passphrase. Defaults to `'TESTNET'`.

Contract arguments are `TypedArg` values: plain JS values are auto-detected (`boolean` → bool, `bigint` → i128, `number` → i32, 56-char `G…`/`C…` string → address, other `string` → string, `Uint8Array` → bytes, array → vec, object → map), or pass `{ value, type }` to force a type (`'u32'`, `'u64'`, `'u128'`, `'symbol'`, `'bytes'`, `'enum'`, …).

**Returns:**
An object containing:
- `callFunction` (`(name: string, args?: TypedArg[]) => Promise<unknown>`): Read-only call via simulation; resolves with the decoded return value (`null` if none). If the footprint has expired it resolves with `{ requiresRestore: true, restorePreamble, transactionData }` and sets `error`. Throws on a simulation error.
- `simulateContractCall` (`(name: string, args?: TypedArg[]) => Promise<SimulateContractCallResult>`): Resolves with `{ result, minResourceFee, latestLedger }` — the decoded return value, the minimum resource fee in stroops (string) and the simulation ledger — for showing a preview before submitting. Throws `Simulation failed: …` on error.
- `buildInvokeXDR` (`(name: string, args?: TypedArg[]) => Promise<string>`): Resolves with the unsigned invocation transaction XDR for a wallet to sign. It is built against a throwaway source account with a flat 100-stroop fee.
- `submitInvokeWithSecret` (`(xdr: string, secret: string) => Promise<rpc.Api.SendTransactionResponse>`): **Development only.** Signs `xdr` with `secret` and sends it via RPC `sendTransaction`, resolving with the send response (it does not poll for the final status).
- `loading` (boolean): True while any of the calls above is in flight.
- `error` (Error | null | undefined): Error from the most recent call; cleared when the next call starts.

**Example:**
```tsx
import { useState } from 'react';
import {
  useSorobanContract,
  type SimulateContractCallResult,
} from '@/hooks/useSorobanContract';

function Transfer({ from, to }: { from: string; to: string }) {
  const { simulateContractCall, buildInvokeXDR, loading, error } = useSorobanContract({
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID!,
  });
  const [preview, setPreview] = useState<SimulateContractCallResult>();

  const args = [from, to, { value: '1000000', type: 'i128' as const }];

  const handlePreview = async () => {
    setPreview(await simulateContractCall('transfer', args));
  };

  const handleConfirm = async () => {
    const xdr = await buildInvokeXDR('transfer', args);
    // Hand `xdr` to your wallet adapter for signing and submission.
  };

  return (
    <div>
      <button onClick={handlePreview} disabled={loading}>Preview</button>
      {preview && (
        <p>
          Fee: {preview.minResourceFee} stroops (ledger #{preview.latestLedger})
          <button onClick={handleConfirm}>Confirm</button>
        </p>
      )}
      {error && <p>{error.message}</p>}
    </div>
  );
}
```

---

## Utility Hooks

### `useClipboard(options)`

Copies text to the clipboard and exposes a timed `copied` flag for "Copied!" feedback. Used by `CopyButton`; no provider is required.

**Signature:**
```typescript
function useClipboard(options?: UseClipboardOptions): UseClipboardResult
```

**Parameters:**
- `options.resetDelayMs` (number, optional): How long `copied` stays `true` after a successful copy, in milliseconds. Defaults to `2000`.

**Returns:**
An object containing:
- `copied` (boolean): True for `resetDelayMs` after the most recent successful copy. Copying again restarts the timer.
- `error` (Error | null): Set when the last attempt failed — the Clipboard API is unavailable (e.g. an insecure context) or the write was rejected. Cleared by the next successful copy.
- `copy` (`(text: string) => Promise<boolean>`): Writes `text` to the clipboard and resolves `true` on success, `false` otherwise. An empty string resolves `false` without touching the clipboard.

**Example:**
```tsx
import { useClipboard } from '@/hooks/useClipboard';

function CopyTxHash({ hash }: { hash: string }) {
  const { copied, error, copy } = useClipboard({ resetDelayMs: 1500 });

  return (
    <div>
      <button onClick={() => copy(hash)}>{copied ? 'Copied!' : 'Copy hash'}</button>
      {error && <p role="alert">{error.message}</p>}
    </div>
  );
}
```
