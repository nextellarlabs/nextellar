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

## SEP Hooks

### `useSep38Quote(options?)`

Requests indicative (non-binding) prices and firm (binding) quotes from a [SEP-38](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md) anchor quote server. Discover the quote server first with `discoverSep38QuoteServer(homeDomain)` (`@/lib/sep38`), which resolves `ANCHOR_QUOTE_SERVER` from the domain's `stellar.toml`.

Does not fetch on mount, and never fetches automatically as parameters change — a quote is only requested when `getIndicativePrice`/`getFirmQuote` is called, since anchor quote requests can be rate-limited and a firm quote should never be requested unintentionally.

**Signature:**
```typescript
function useSep38Quote(options?: UseSep38QuoteOptions): UseSep38QuoteReturn
```

**Returns:**
An object containing:
- `getIndicativePrice(params)`: Requests `GET /price`. Returns a `Sep38IndicativePrice` (`kind: 'indicative'`) — informational only, never binding.
- `getFirmQuote(params)`: Requests `POST /quote` (requires a SEP-10 `authToken`). Returns a `Sep38FirmQuote` (`kind: 'firm'`) with an `id` and an `expiresAt` taken as-is from the anchor — never fabricated or extended client-side.
- `quote` (`Sep38IndicativePrice | Sep38FirmQuote | undefined`): The most recently resolved result. Check `quote.kind` before treating it as executable.
- `loading` (boolean), `error` (Error | null).
- `isExpired` (boolean): True once a firm quote's `expiresAt` has passed. Always `false` for an indicative price.
- `reset()`: Clears `quote` and `error`.

**Example:**
```tsx
import { useSep38Quote } from '@/hooks/useSep38Quote';
import { discoverSep38QuoteServer } from '@/lib/sep38';

async function getPrice() {
  const quoteServer = await discoverSep38QuoteServer('anchor.example.com');
  const { getIndicativePrice, quote, loading, error } = useSep38Quote();

  await getIndicativePrice({
    quoteServer,
    sellAsset: 'iso4217:USD',
    buyAsset: 'stellar:XLM:GISSUER...',
    sellAmount: '100',
    context: 'sep6',
  });
}
```

### `useSep24Interactive(options?)`

Runs the [SEP-24](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md) hosted deposit/withdraw flow:

1. Requests the anchor's interactive URL (`POST /transactions/{deposit|withdraw}/interactive`).
2. Opens it in a popup, or exposes it for `<Sep24InteractiveFrame>`.
3. Listens for the anchor's `postMessage` updates. Only messages from the anchor's origin about this transaction are accepted.
4. Polls `GET /transaction` as a fallback, which covers anchors that redirect instead of posting messages.

Discover the server with `discoverSep24TransferServer(homeDomain)` (`@/lib/sep24`). Get the `authToken` from SEP-10.

**Signature:**
```typescript
function useSep24Interactive(options?: {
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;         // default 5000, 0 disables polling
  closePopupOnComplete?: boolean;  // default true
  onUpdate?: (tx: Sep24Transaction) => void;
}): UseSep24InteractiveReturn
```

**Returns:**
- `start(opts)`: `opts` is `{ transferServer, kind: 'deposit' | 'withdraw', authToken, assetCode, assetIssuer?, account?, amount?, lang?, extra?, mode?: 'popup' | 'iframe' }`.
- `status`: one of
  - `idle`, `starting`, `interactive`
  - `pending`: the user finished the form. For a withdrawal, `transaction.withdraw_anchor_account` / `withdraw_memo` say where to send funds.
  - `completed`, `failed`
  - `closed`: the user closed the window before finishing.
  - `error`: for example a blocked popup. `url` is still set so you can show a link.
- `transaction`, `transactionId`, `url`, `error`
- `cancel()`, `reset()`

**Example:**
```tsx
import { useSep24Interactive } from '@/hooks/useSep24Interactive';
import Sep24InteractiveFrame from '@/components/Sep24InteractiveFrame';
import { discoverSep24TransferServer } from '@/lib/sep24';

function Deposit({ jwt, account }: { jwt: string; account: string }) {
  const sep24 = useSep24Interactive();

  async function onDeposit() {
    const transferServer = await discoverSep24TransferServer('testanchor.stellar.org');
    await sep24.start({ transferServer, kind: 'deposit', authToken: jwt, assetCode: 'USDC', account, mode: 'iframe' });
  }

  return (
    <>
      <button onClick={onDeposit}>Deposit USDC</button>
      {sep24.url && sep24.status === 'interactive' && (
        <Sep24InteractiveFrame url={sep24.url} onClose={sep24.cancel} />
      )}
      {sep24.status === 'completed' && <p>Deposit complete: {sep24.transaction?.amount_out}</p>}
    </>
  );
}
```

`<Sep24InteractiveFrame url onClose? closeLabel? title? height?>` only renders https URLs (or http://localhost). It sandboxes the iframe to `allow-scripts allow-same-origin allow-forms allow-popups`.

---

## Multi-sig Hooks

### `useMultisigTransaction(account, networkPassphrase)`

Collects signatures for a transaction that needs several signers, and tracks
which of the account's signers have signed and whether the threshold is met.
It wraps `createMultisigSession` from `@/lib/multisig`. That module also exports:
- `buildMultisigTransaction({ source, operations, networkPassphrase, fee?, timeoutSeconds?, memo? })`, with a default 1-hour timeout to leave time for collecting signatures
- `evaluateSignatures(tx, account)`
- `thresholdLevelForTransaction(tx)`

`account` is the Horizon account record (`thresholds` + `signers`), e.g. from `server.loadAccount(id)`.

The threshold level (low/medium/high) is derived from the operations, using Stellar's threshold table. A threshold of 0 still needs weight 1.

Supported signer types:
- `ed25519_public_key`: the signature is verified against the transaction hash. A matching hint alone is not enough.
- `preauth_tx`
- `sha256_hash`
- `ed25519_signed_payload` signers are reported with `supported: false` and are not counted.

**Returns:**
- `load(txOrXdr, { thresholdLevel? })`
- `addSignedXdr(xdr)`: merges a co-signer's signed copy. It is rejected if the copy is for a different transaction.
- `addSignature(publicKey, base64Sig)`, `signWith(keypair)`, `reset()`
- `status`: `{ requiredWeight, signedWeight, thresholdMet, signers[], pendingSigners[], unknownSignatures }`
- `xdr`: the envelope with every collected signature
- `thresholdMet`, `error`

`unknownSignatures > 0` means the envelope carries a signature from a non-signer. The network rejects that with `tx_bad_auth_extra`.

**Example:**
```tsx
import { Networks } from '@stellar/stellar-sdk';
import { useMultisigTransaction } from '@/hooks/useMultisigTransaction';

const multisig = useMultisigTransaction(accountRecord, Networks.TESTNET);
multisig.load(unsignedXdr);
multisig.addSignedXdr(signedByAlice);
multisig.addSignedXdr(signedByBob);
if (multisig.thresholdMet) await server.submitTransaction(TransactionBuilder.fromXDR(multisig.xdr!, Networks.TESTNET));
```

Limitation: only the transaction source account's signers are evaluated.
Operations with a different `source` also need that account's threshold.

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
