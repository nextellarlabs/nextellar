# Cookbook: Claimable Balances (Create & Claim with Predicates)

A claimable balance is XLM or an issued asset that is reserved on-chain until a
specific account — the *claimant* — satisfies a *predicate*. The creator gives
up control of the funds immediately: only claimants whose predicate evaluates to
true can claim them, so the same primitive covers escrow, delayed payouts,
vesting, refund windows and airdrops.

This recipe builds both halves of the flow using the template hooks:

- `useStellarWallet` — connect a wallet, get the address, refresh balances.
- `useStellarPayment` — submit the signed transaction and surface Stellar
  result codes.
- `signTransaction` from `src/lib/stellar-wallet-kit.ts` — sign the XDR with the
  connected wallet.

Claimable balances have no dedicated hook yet, so the transactions themselves
are built with `@stellar/stellar-sdk` operations
(`Operation.createClaimableBalance`, `Operation.claimClaimableBalance`).

---

## Overview

| Step | What happens |
| --- | --- |
| Create | Build `create_claimable_balance` with one or more `Claimant`s, each with an `xdr.ClaimPredicate`, sign, submit. |
| List | Query Horizon with `server.claimableBalances().claimant(publicKey)`. |
| Claim | Build `claim_claimable_balance` with the balance's ID, sign as the claimant, submit. |

Predicates are evaluated against the **ledger close time**, not the client
clock, so timestamps can drift by a few seconds without breaking anything.

---

## Predicate cheat sheet

All helpers live on the `Claimant` class and return an `xdr.ClaimPredicate`:

| Helper | Meaning |
| --- | --- |
| `Claimant.predicateUnconditional()` | Can claim at any time. |
| `Claimant.predicateBeforeAbsoluteTime(ts)` | Can claim **before** the Unix timestamp `ts` (seconds, as a string). |
| `Claimant.predicateBeforeRelativeTime(seconds)` | Can claim within `seconds` of the balance being created. |
| `Claimant.predicateNot(predicate)` | Inverts a predicate. |
| `Claimant.predicateAnd(left, right)` | Both predicates must hold. |
| `Claimant.predicateOr(left, right)` | Either predicate may hold. |

Predicates can be nested, which is how you express windows such as "the
recipient can claim for 7 days, then the sender can reclaim".

---

## Step 1: Create a claimable balance with predicates

The example below is a refundable escrow: the recipient can claim at any time,
and the sender gets a fallback claim that only unlocks after `reclaimAfterDays`.

```tsx
'use client';

import { useCallback, useState } from 'react';
import {
  Asset,
  BASE_FEE,
  Claimant,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { useStellarPayment, useStellarWallet } from 'nextellar/hooks';
import { signTransaction } from '../lib/stellar-wallet-kit';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);

type ClaimableBalance = {
  balanceId: string;
  asset: string;
  amount: string;
};

function EscrowPanel() {
  const { connected, publicKey, connect, refreshBalances } = useStellarWallet(
    HORIZON_URL,
    NETWORK_PASSPHRASE,
  );
  const { submitSignedXDR } = useStellarPayment({
    horizonUrl: HORIZON_URL,
    network: 'TESTNET',
  });

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('10');
  const [reclaimAfterDays, setReclaimAfterDays] = useState(7);
  const [balances, setBalances] = useState<ClaimableBalance[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Build, sign and submit a claimable balance the connected account funds.
   */
  const createBalance = useCallback(async () => {
    if (!publicKey) {
      setError('Connect a wallet first');
      return;
    }

    setError(null);
    setStatus('Creating claimable balance…');

    try {
      const account = await horizon.loadAccount(publicKey);
      const deadline = String(
        Math.floor(Date.now() / 1000) + reclaimAfterDays * 24 * 60 * 60,
      );

      const claimants = [
        // The recipient can claim at any time.
        new Claimant(destination, Claimant.predicateUnconditional()),
        // The sender can only reclaim once the deadline has passed.
        new Claimant(
          publicKey,
          Claimant.predicateNot(
            Claimant.predicateBeforeAbsoluteTime(deadline),
          ),
        ),
      ];

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.createClaimableBalance({
            asset: Asset.native(), // or new Asset('USDC', issuer)
            amount,
            claimants,
          }),
        )
        .setTimeout(30)
        .build();

      const signedXdr = await signTransaction({
        unsignedTransaction: transaction.toXDR(),
        address: publicKey,
      });

      const result = await submitSignedXDR(signedXdr);
      if (!result.success) {
        throw new Error(result.error ?? 'Claimable balance creation failed');
      }

      setStatus(`Created claimable balance in ${result.txHash}`);
      await refreshBalances();
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }, [
    publicKey,
    destination,
    amount,
    reclaimAfterDays,
    submitSignedXDR,
    refreshBalances,
  ]);

  return (
    <div className="space-y-4">
      {!connected && <button onClick={() => connect()}>Connect wallet</button>}

      <input
        value={destination}
        onChange={(event) => setDestination(event.target.value)}
        placeholder="Claimant address (G…)"
      />
      <input
        type="number"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
      />
      <input
        type="number"
        value={reclaimAfterDays}
        onChange={(event) => setReclaimAfterDays(Number(event.target.value))}
        placeholder="Sender can reclaim after (days)"
      />
      <button onClick={createBalance} disabled={!connected}>
        Create claimable balance
      </button>

      {status && <p>{status}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```

Notes:

- The transaction source account (`publicKey`) pays the base fee plus **two
  base reserves** per balance, so creating a balance requires enough XLM.
- For an issued asset, the creator must hold the asset and the claimant must
  have a trustline for it before claiming, or the claim fails with
  `op_no_trust`.
- A claimant can be any account, including the creator itself, which is how
  self-imposed time locks are built.

---

## Step 2: List balances the connected account can claim

Add these inside `EscrowPanel` (the snippet also needs `useEffect` from React).
Horizon filters balances by claimant, so a claimant-facing view only needs the
public key:

```tsx
const loadBalances = useCallback(async () => {
  if (!publicKey) return;

  const page = await horizon
    .claimableBalances()
    .claimant(publicKey)
    .limit(50)
    .call();

  setBalances(
    page.records.map((record) => ({
      // `id` on a Horizon claimable-balance record is the balance ID.
      balanceId: record.id,
      asset: record.asset === 'native' ? 'XLM' : record.asset,
      amount: record.amount,
    })),
  );
}, [publicKey]);

useEffect(() => {
  void loadBalances();
}, [loadBalances]);
```

The `id` on each record (for example
`00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be`)
is what the claim operation needs — keep the whole string. Operation responses
and transaction effects also report it as `balance_id`, so don't confuse the
naming if you correlate the two.

---

## Step 3: Claim a balance

Add the claim handler and list markup to the same component. Claiming is a
normal transaction signed by the claimant. The network itself
checks the predicate, so a claim submitted before the predicate is satisfied
fails with `op_cant_claim` rather than being silently ignored:

```tsx
const claimBalance = useCallback(
  async (balanceId: string) => {
    if (!publicKey) {
      setError('Connect a wallet first');
      return;
    }

    setError(null);
    setStatus('Claiming…');

    try {
      const account = await horizon.loadAccount(publicKey);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.claimClaimableBalance({ balanceId }))
        .setTimeout(30)
        .build();

      const signedXdr = await signTransaction({
        unsignedTransaction: transaction.toXDR(),
        address: publicKey,
      });

      const result = await submitSignedXDR(signedXdr);
      if (!result.success) {
        throw new Error(result.error ?? 'Claim failed');
      }

      setStatus(`Claimed in ${result.txHash}`);
      await Promise.all([loadBalances(), refreshBalances()]);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  },
  [publicKey, submitSignedXDR, loadBalances, refreshBalances],
);

return (
  <ul>
    {balances.map((balance) => (
      <li key={balance.balanceId}>
        {balance.amount} {balance.asset}
        <button onClick={() => claimBalance(balance.balanceId)}>Claim</button>
      </li>
    ))}
  </ul>
);
```

`submitSignedXDR` already decodes Horizon's `extras.result_codes` (for example
`op_cant_claim`, `op_no_trust`, `op_does_not_exist`), so the user-facing error
from `result.error` explains why a claim was rejected.

---

## Predicate patterns

**Refund window** — the recipient can claim for 7 days, then only the sender
can:

```tsx
const oneWeek = '604800'; // seconds

const claimants = [
  // The recipient has one week from creation to claim.
  new Claimant(recipient, Claimant.predicateBeforeRelativeTime(oneWeek)),
  // After that week, the sender can take the funds back.
  new Claimant(sender, Claimant.predicateNot(Claimant.predicateBeforeRelativeTime(oneWeek))),
];
```

**Escrow release on a date** — the recipient can only claim once the deadline
has passed:

```tsx
const deadline = String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

const claimant = new Claimant(
  recipient,
  Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(deadline)),
);
```

**Combined conditions** — an airdrop that can be claimed in the first hour, or
any time after 30 days:

```tsx
new Claimant(
  recipient,
  Claimant.predicateOr(
    Claimant.predicateBeforeRelativeTime('3600'),
    Claimant.predicateNot(Claimant.predicateBeforeRelativeTime('2592000')),
  ),
);
```

Remember that `predicateBeforeRelativeTime` is measured from the ledger at which
the balance was **created**, while `predicateBeforeAbsoluteTime` is a fixed Unix
timestamp in seconds. Both take strings.

---

## Best Practices & Tips

1. **Confirm the predicate on-chain, not in the UI.** Hide or disable the claim
   button where you can, but let the network be the source of truth — a claim
   before the deadline fails with `op_cant_claim`, and that error should be shown
   to the user rather than thrown away.
2. **Keep the balance ID.** It is the only handle for a claim (`record.id` from
   Horizon; `balance_id` in operation responses). Persist it if you display
   balances outside a live Horizon query.
3. **Fund for reserves.** Each balance locks two base reserves on the creator or
   sponsor. Creating many small balances can strand XLM that only returns when
   the balances are claimed or clawed back.
4. **Trustlines for issued assets.** A claimant must hold a trustline for a
   non-native asset before claiming; check with `useTrustlines` first.
5. **Use the same network everywhere.** `useStellarWallet`, `useStellarPayment`
   and your `Horizon.Server` instance must point at the same network passphrase
   and URL, or a balance created on testnet will never appear in the list.
