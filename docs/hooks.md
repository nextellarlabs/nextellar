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
A standalone wallet hook build directly on Stellar Wallets Kit (Freighter, Albedo, Lobstr, ...). Unlike `useWallet()`, it does not need `WalletProvider` — each call owns its own connection state. The connection is persisted to `localStorage` and restored on mount if the kit still reports the same address.

**Signature:**
```typescript
function useStellarWallet(horizonUrl?: string, network?: string): StellarWalletState
```

**Parameters:**
- `horizonUrl` (string, optional): Horizon server used for balances and payment submission. Defaults to `'https://horizon-testnet.stellar.org'. Read once on mount; later changes are ignored.
- `network` (string, optional): Network **passphrase** used to build and sign payments. Defaults to `Networks.TESTNET` .

**Returns:**
An object containing:
- `connected` (boolean): True once a wallet has been selected and its address read.
- `publicKey` (string | undefined): The connected account's address.
- `walletName` (string | undefined): The selected wallet's display name.
- `balances` (Balance[]): Raw Horizon balance lines (`balance`, `asset_type`, `asset_code?`, `asset_issuer?`). Empty for an unfunded account.
- `connect` (`() => Promise<void>`): Opens the Stellar Wallets Kit selection modal; state updates when the user picks a wallet. Rethrows if the kit fails.
- `disconnect` (`() => void`): Disconnects the kit, clears state and the persisted connection.
- `refreshBalances` (`() => Promise<void>`): Re-fetches balances for `publicKey`; a no-op while disconnected.
- `sendPayment` (`((opts: PaymentOptions) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>)  | undefined`): Only defined while connected. Builds a payment (`to`, `amount`, optional `asset` — `'XLM'` or `{ code, issuer }` — and `memo`), signs it through the wallet, submits it to Horizon, refreshes balances and resolves with the Horizon response. Throws on failure.

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
      {offers.bids.map(bid => <p key={bid.price}>{bid.amount} @{bid.price}</p>)}
      <h3>Asks</h3>
      {offers.asks.map(ask => <p key={ask.price}>{ask.amount} @{ask.price}</p>)}
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
- `opts.sorobanRpc` (string, optional): Soroban RPC URL. Defaults to `'https://soroban-testnet.stellar.org''.
- `opts.network` (`'TESTNET' | 'PUBLIC'`, optional): Selects the network passphrase. Defaults to `'TESTNET'`.

Contract arguments are `TypedArg` values: plain JS values are auto-detected (`boolean` → bool, `bigint` → i128, `number` → i32, 56-char `G…`/`C…` string → address, other `string` → string, `Uint8Array` → bytes, array → vec, object → map), or pass `{ value, type }` to force a type (`'u32', 'u64', 'u128', 'symbol', 'bytes', 'enum', …).

**Returns:**
An object containing:
- `callFunction` (`(name: string, args?: TypedArg[]) => Promise<unknown>`): Read-only call via simulation; resolves with the decoded return value (`null` if none). If the footprint has expired it resolves with `{ requiresRestore: true, restorePreamble, transactionData }` and sets `error`. Throws on a simulation error.
- `simulateContractCall` (`(name: string, args?: TypedArg[]) => Promise<SimulateContractCallResult>`): Resolves with `{ result, minResourceFee, latestLedger }` — the decoded return value, the minimum resource fee in stroops (string) and the simulation ledger — for showing a preview before submitting. Throws `Simulation failed: …' on error.
- `buildInvokeXDR` (`(name: string, args?: TypedArg[]) => Promise<string>`): Resolves with the unsigned invocation transaction XDR for a wallet to sign. It is built against a throwaway source account with a flat 100-stroop fee.
- `submitInvokeWithSecret` (`(xdr: string, secret: string) => Promise<rpc.Api.SendTransactionResponse>`): **Development only.** Signs `xdr` with `secret` and sends it via R PC `sendTransaction`, resolving with the send response (it does not poll for the final status).
- `loading` (boolean): True while any of the calls above is in flight.
- `error` (Error | null | undefined): Error from the most recent call; cleared when the next call starts.

**Example:**
```tsx
import { useSorobanContract } from 'nextellar/hooks';

function ContractCall() {
  const { callFunction, loading, error } = useSorobanContract({
    contractId: 'CABC...',
  });

  const handleCall = async () => {
    const result = await callFunction('balance', ['GABC...']);
    console.log(result);
  };

  return (
    <button onClick={handleCall} disabled={loading}>
      {error ? `Error: ${error.message}` : 'Call Contract'}
    </button>
  );
}
```

### `useContractDeploy()`

Deploys a Soroban contract from compiled WASM bytes, building the installation transaction and submitting it through the connected wallet.

**Signature:**
```typescript
function useContractDeploy(opts?: ContractDeployOptions): ContractDeployReturn
```

**Parameters:**
- `opts.sorobanRpc` (string, optional): Soroban R PC URL. Defaults to `'https://soroban-testnet.stellar.org''.
- `opts.network` (`'TESTNET' | 'PUBLIC'`, optional): Network passphrase selector. Defaults to `'TESTNET'`.
- `opts.publicKey` (string, optional): Source account for the deployment transaction. Required when submitting.

**Returns:**
An object containing:
- `deploy` (`(opts: { wasm: Uint8Array | Buffer; salt?: string; constructorArgs?: TypedArg[] }) => Promise<{ contractId: string; txHash: string }>`): Builds, signs and submits the deployment; resolves with the new contract address and transaction hash.
- `buildDeployXDR` (`(opts: { wasm: Uint8Array | Buffer; salt?: string; constructorArgs?: TypedArg[] }) => Promise<string>`): Resolves with the unsigned deployment transaction XDR for external signing.
- `contractId` (string | undefined): The most recently deployed contract address.
- `loading` (boolean): True while a deployment is in flight.
- `error` (Error | null): Error from the most recent deploy; cleared when the next deploy starts.

**Example:**
```tsx
import { useContractDeploy } from 'nextellar/hooks';

function DeployForm() {
  const { deploy, contractId, loading, error } = useContractDeploy();

  const handleDeploy = async (file: File) => {
    const wasm = new Uint8Array(await file.arrayBuffer());
    const { contractId } = await deploy({ wasm });
    console.log('Deployed at', contractId);
  };

  return (
    <div>
      <input type="file" onChange={(e) => e.target.files?.[0] && handleDeploy(e.target.files[0])} />
      {loading && <p>Deploying...</p>}
      {error && <p>Error: {error.message}</p>}
      {contractId && <p>Contract: t{contractId}</p>}
    </div>
  );
}
```

### `useContractEventHistory()`

Fetches the historical event log for a Soroban contract within a ledger range, with optional topic filtering and pagination.

**Signature:**
```typescript
function useContractEventHistory(opts: ContractEventHistoryOptions): ContractEventHistoryReturn
```

**Parameters:**
- `opts.contractId` (string): StrKey contract address (`C…`). Required.
- `opts.startLedger` (number, optional): Lowest ledger to include. Defaults to the latest ledger minus `1000`.
- `opts.endLedger` (number, optional): Highest ledger to include. Defaults to the latest ledger.
- `opts.topics` (array, optional): Topic filters (e.g. `['(transfer)', '*']`).
- `opts.limit` (number, optional): Maximum number of events per page. Defaults to `200`.
- `opts.sorobanRpc` (string, optional): Soroban R PC URL. Defaults to `'https://soroban-testnet.stellar.org''.

**Returns:**
An object containing:
- `events` (array): Decoded contract events in ledger order.
- `loading` (boolean): True while fetching.
- `error` (Error | null): Error from the most recent fetch.
- `fetchMore` (`() => Promise<void>`): Loads the next page of events and appends them to `events`.
- `hasMore` (boolean): True when a further page is available.
- `refresh` (`() => Promise<void>`): Re-fetches from the first page.

**Example:**
```tsx
import { useContractEventHistory } from 'nextellar/hooks';

function EventLog({ contractId }) {
  const { events, loading, hasMore, fetchMore } = useContractEventHistory({
    contractId: contractId,
    topics: ['(*,', '(swap)'],
  });

  return (
    <div>
      {loading && <p>Loading events...</p>}
      <ul>{events.map((e, i) => <li key={i}>{e.type}</li>)}</ul>
      {hasMore && <button onClick={fetchMore}>Load more</button>}
    </div>
  );
}
```

### `useContractUpgrade()`

Upgrades an existing Soroban contract to a new WASM hash by building and submitting the upgrade invocation through the connected wallet.

**Signature:**
```typescript
function useContractUpgrade(opts?: ContractUpgradeOptions): ContractUpgradeReturn
```

**Parameters:**
- `opts.sorobanRpc` (string, optional): Soroban R PC URL. Defaults to `'https://soroban-testnet.stellar.org''.
- `opts.network` (`'TESTNET' | 'PUBLIC'`, optional): Network passphrase selector. Defaults to `'TESTNET'`.
- `opts.publicKey` (string, optional): Source account for the upgrade transaction. Required when submitting.

**Returns:**
An object containing:
- `upgrade` (`(opts: { contractId: string; newWasmHash: Uint8Array | Buffer }) => Promise<{ txHash: string }>`): Builds, signs and submits the upgrade; resolves with the transaction hash.
- `buildUpgradeXDR` (`(opts: { contractId: string; newWasmHash: Uint8Array | Buffer }) => Promise<string>`): Resolves with the unsigned upgrade transaction XDR for external signing.
- `loading` (boolean): True while an upgrade is in flight.
- `error` (Error | null): Error from the most recent upgrade; cleared when the next upgrade starts.

**Example:**
```tsx
import { useContractUpgrade } from 'nextellar/hooks';

function UpgradeButton({ contractId, newWasmHash }) {
  const { upgrade, loading, error } = useContractUpgrade();

  const handleUpgrade = async () => {
    const { txHash } = await upgrade({ contractId, newWasmHash });
    console.log('Upgraded in tx', txHash);
  };

  return (
    <button onClick={handleUpgrade} disabled={loading}>
      {error ? `Error: ${error.message}` : 'Upgrade Contract'}
    </button>
  );
}
```

---

## Horizon Streaming Hooks

### `useHorizonStreaming()`

Subscribes to a Horizon SEE event stream (account, ledger, transaction or operations) and delivers decoded envelopes to your component.

**Signature:**
```typescript
function useHorizonStreaming(opts: HorizonStreamingOptions): HorizonStreamingReturn
```

**Parameters:**
- `opts.resource` (`'accounts' | 'ledgers' | 'transactions' | 'operations'`): Stream resource type.
- `opts.id` (string, optional): Resource ID (account address, ledger number, tx hash). Required for `accounts`, `ledgers` and `transactions`.
- `opts.cursor` (string, optional): Starting cursor. Defaults to `now`.
- `opts.horizonUrl` (string, optional): Horizon server URL. Defaults to `'https://horizon-testnet.stellar.org''.
- `opts.enabled` (boolean, optional): Whether the stream is active. Defaults to `true`.

**Returns:**
An object containing:
- `events` (array): Events received since mount, newest last.
- `connected` (boolean): True while the EventSource is open.
- `error` (Error | null): Error from the stream, if any.
- `clear` (`() => void`): Empties the buffered `events`.

**Example:**
```tsx
import { useHorizonStreaming } from 'nextellar/hooks';

function LivePayments({ publicKey }) {
  const { events, connected } = useHorizonStreaming({
    resource: 'accounts',
    id: publicKey,
  });

  return (
    <div>
      <p>{connected ? 'Streaming' : 'Disconnected'}</p>
      <ul>{events.map((e, i) => <li key={i}>{e.type}</li>)}</ul>
    </div>
  );
}
```

---

## UI Hooks

### `usePrefersReducedMotion()`

Returns whether the user has requested minimal non-essential motion via the `prefers-reduced-motion` media query. SSR-safe: returns `false` on the server and updates after hydration.

**Signature:**
```typescript
function usePrefersReducedMotion(): boolean
```

**Returns:**
- `boolean`: True when the user prefers reduced motion.

**Example:**
```tsx
import { usePrefersReducedMotion } from 'nextellar/hooks';

function AnimatedCard() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className={reducedMotion ? 'static' : 'transition-all duration-300'}>
      Hover me
    </div>
  );
}
```

---

## SEP Hooks

### `useSep24Interactive()`

Drives the SEP-24 interactive deposit/withdrawal flow: fetches the transfer server info, builds the interactive URL and polls the transaction status until it terminates.

**Signature:**
```typescript
function useSep24Interactive(opts: Sep24InteractiveOptions): Sep24InteractiveReturn
```

**Parameters:**
- `opts.transferServer` (string): SEP-24 transfer server URL.
- `opts.assetCode` (string): Asset code (e.g. `'USDC'`).
- `opts.assetIssuer` (string, optional): Asset issuer; omit for native XLM.
- `opts.amount` (string, optional): Amount to deposit. Required for deposits.
- `opts.account` (string): Stellar account address for withdrawals.
- `opts.language` (string, optional): Built-in anchor UI language. Defaults to `'en'`.

**Returns:**
An object containing:
- `interactiveUrl` (string | null): URL to open in an iframe or web view for the anchor flow.
- `transaction` (Sep24Transaction | null): Latest transaction status payload.
- `status` (string | null): SEP-24 status (`incomplete`, `pending_anchor`, `completed`, …).
- `loading` (boolean): True while fetching info or polling.
- `error` (Error | null): Error from the most recent request.
- `start` (`() => Promise<void>`): Fetches the transfer server info and builds `interactiveUrl`.
- `poll` (`() => Promise<void>`): Fetches the current transaction status once.

**Example:**
```tsx
import { useSep24Interactive } from 'nextellar/hooks';

function DepositFlow() {
  const { interactiveUrl, status, start, poll, loading } = useSep24Interactive({
    transferServer: 'https://testanchor.stellar.org',
    assetCode: 'USDC',
    assetIssuer: 'GABC...',
    amount: '10',
  });

  return (
    <div>
      <button onClick={start} disabled={loading}>Start deposit</button>
      {interactiveUrl && <iframe src={interactiveUrl} />}
      {status && <p>Status: {status}</p>}
      <button onClick={poll}>Refresh status</button>
    </div>
  );
}
```

### `useSep30Recovery()`

Implements the SEP-30 recovery flow for a wallet: registers an identity with the anchor, signs the challenge transaction and submits the signed challenge to complete recovery.

**Signature:**
```typescript
function useSep30Recovery(opts: Sep30RecoveryOptions): Sep30RecoveryReturn
```

**Parameters:**
- `opts.sep30Url` (string): SEP-30 server URL.
- `opts.account` (string): Stellar account to recover.
- `opts.signer` (`(xdr: string) => Promise<string>`): Signs the challenge XDR and resolves with the signed XDR.
- `opts.jwt` (string, optional): Existing SEP-30 JWT to reuse instead of registering.

**Returns:**
An object containing:
- `recover` (`() => Promise<void>`): Runs the recovery flow (challenge → sign → submit).
- `jwt` (string | null): The SEP-30 JWT returned by the server.
- `loading` (boolean): True while the recovery flow is running.
- `error` (Error | null): Error from the most recent flow.

**Example:**
```tsx
import { useSep30Recovery } from 'nextellar/hooks';
import { signTransaction } from '@stellar/stellar-base';

function RecoverButton({ account, keypair }) {
  const { recover, jwt, loading, error } = useSep30Recovery({
    sep30Url: 'https://sep30-anchor.stellar.org',
    account,
    signer: async (xdr) => {
      const tx = new Transaction(xdr, 'Test Stellar Network ; September 2015');
      tx.sign(keypair);
      return tx.toXDR();
    },
  });

  return (
    <div>
      <button onClick={recover} disabled={loading}>Recover account</button>
      {jwt && <p>Recovered. JWT issued.</p>}
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```

### `useSep38Quote()`

Fetches and caches SEP-38 firm quotes from an anchor for a given asset pair and amount.

**Signature:**
```typescript
function useSep38Quote(opts: Sep38QuoteOptions): Sep38QuoteReturn
```

**Parameters:**
- `opts.sep38Url` (string): SEP-38 server URL.
- `opts.sellAsset` (string): Asset being sold (e.g. `'XLIM'USDC'`).
- `opts.buyAsset` (string): Asset being bought.
- `opts.sellAmount` (string, optional): Amount to sell. Provide either `sellAmount` or `buyAmount`.
- `opts.buyAmount` (string, optional): Amount to buy.
- `opts.context` (`'default' | 'strict-send' | 'strict-receive'`, optional): Quote context. Defaults to `'default'`.

**Returns:**
An object containing:
- `quote` (Sep38Quote | null): The most recent quote payload (`price`, `sellAmount`, `buyAmount`, `fee`, ...).
- `quotes` (Sep38Quote[]): History of quotes fetched by this hook.
- `loading` (boolean): True while a request is in flight.
- `error` (Error | null): Error from the most recent request.
- `fetchQuote` (`() => Promise<Sep38Quote | null>`): Fetches a quote for the configured pair and amount.
- `clear` (`() => void`): Clears `quote`, `quotes` and `error`.

**Example:**
```tsx
import { useSep38Quote } from 'nextellar/hooks';

function QuotePanel() {
  const { quote, fetchQuote, loading, error } = useSep38Quote({
    sep38Url: 'https://sep38-anchor.stellar.org',
    sellAsset: 'XLM:ISSU'USDC',
    buyAsset: 'XLIM:ISSUE'USDC',
    sellAmount: '100',
  });

  return (
    <div>
      <button onClick={fetchQuote} disabled={loading}>Get quote</button>
      {quote && <p>{quote.buyAmount} for {quote.sellAmount} (price {quote.price})</p>}
      {error && <p>Error: {error.message}</p>}
    </div>
  );
}
```