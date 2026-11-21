# Cookbook: Claimable Balances

Claimable balances let a sender lock funds in a Stellar ledger entry with time or condition **predicates** so the recipient (or the sender, after an expiry) can claim them later — even if the recipient does not yet hold a trustline or is offline when sent.

---

## Overview

A claimable balance lifecycle has two steps:

1. **Create (`Operation.createClaimableBalance`)**: Lock an asset and amount with one or more `Claimant` records and predicates (e.g. recipient can claim until expiry, sender can reclaim afterwards).
2. **Query & Claim (`server.claimableBalances` + `Operation.claimClaimableBalance`)**: Fetch claimable entries for the connected account and submit a claim transaction (opening a trustline first if claiming a non-native asset).

---

## Step 1: Create a Claimable Balance with Predicates

```tsx
import { useState } from "react";
import {
  Asset,
  BASE_FEE,
  Claimant,
  Horizon,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { useWallet, useWalletConfig } from "../contexts";
import { getKit } from "../lib/stellar-wallet-kit";

export function CreateEscrowBalance({ recipient }: { recipient: string }) {
  const { publicKey, connected } = useWallet();
  const config = useWalletConfig();
  const [balanceId, setBalanceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!connected || !publicKey || !config) return;
    setError(null);

    try {
      const server = new Horizon.Server(config.horizonUrl);
      const sourceAccount = await server.loadAccount(publicKey);

      // Recipient can claim immediately; sender can reclaim after 24 hours.
      const claimWindowSeconds = String(24 * 60 * 60);
      const claimants = [
        new Claimant(recipient, Claimant.predicateUnconditional()),
        new Claimant(
          publicKey,
          Claimant.predicateNot(
            Claimant.predicateBeforeRelativeTime(claimWindowSeconds),
          ),
        ),
      ];

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: config.network,
      })
        .addOperation(
          Operation.createClaimableBalance({
            asset: Asset.native(),
            amount: "25.0000000",
            claimants,
          }),
        )
        .setTimeout(30)
        .build();

      const { signedTxXdr } = await getKit().signTransaction(tx.toXDR(), {
        networkPassphrase: config.network,
        address: publicKey,
      });

      const signedTx = new Transaction(signedTxXdr, config.network);
      const result = await server.submitTransaction(signedTx);
      setBalanceId(result.hash);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create claimable balance",
      );
    }
  };

  return (
    <div className="space-y-2">
      <button onClick={handleCreate} disabled={!connected}>
        Lock 25 XLM Claimable Balance
      </button>
      {balanceId && <p>Submitted tx: {balanceId}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```

### Common Predicate Helpers

- `Claimant.predicateUnconditional()` — Claimable at any time.
- `Claimant.predicateBeforeRelativeTime('3600')` — Claimable within 3,600 seconds of ledger close when created.
- `Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(unixSeconds))` — Claimable **only after** a specific Unix timestamp (`cliff` / `vesting`).

---

## Step 2: List and Claim Pending Balances

```tsx
import { useCallback, useState } from "react";
import {
  BASE_FEE,
  Horizon,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { useWallet, useWalletConfig } from "../contexts";
import { getKit } from "../lib/stellar-wallet-kit";

type ClaimableRecord = Horizon.ServerApi.ClaimableBalanceRecord;

export function ClaimBalancesPanel() {
  const { publicKey, connected } = useWallet();
  const config = useWalletConfig();
  const [entries, setEntries] = useState<ClaimableRecord[]>([]);

  const loadClaimables = useCallback(async () => {
    if (!publicKey || !config) return;
    const server = new Horizon.Server(config.horizonUrl);
    const page = await server
      .claimableBalances()
      .claimant(publicKey)
      .limit(20)
      .call();
    setEntries(page.records);
  }, [publicKey, config]);

  const claimOne = async (balanceId: string) => {
    if (!publicKey || !config) return;
    const server = new Horizon.Server(config.horizonUrl);
    const account = await server.loadAccount(publicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.network,
    })
      .addOperation(Operation.claimClaimableBalance({ balanceId }))
      .setTimeout(30)
      .build();

    const { signedTxXdr } = await getKit().signTransaction(tx.toXDR(), {
      networkPassphrase: config.network,
      address: publicKey,
    });

    await server.submitTransaction(
      new Transaction(signedTxXdr, config.network),
    );
    await loadClaimables();
  };

  return (
    <div className="space-y-3">
      <button onClick={loadClaimables} disabled={!connected}>
        Refresh Claimable Balances
      </button>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.amount} ({entry.asset}){" "}
            <button onClick={() => claimOne(entry.id)}>Claim</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Best Practices & Tips

1. **Trustlines Before Claiming Issued Assets**: Claiming a non-native asset fails with `op_no_trust` unless the claimant holds a trustline; check `useTrustlines` and prepend `Operation.changeTrust` if missing.
2. **Base Reserve Awareness**: Each claimable balance reserves `0.5 XLM` (`1` base reserve) on the sponsor/creator account until all claimants have claimed or clawed back the entry.
3. **Verify Predicate Windows**: Combine `predicateBeforeAbsoluteTime` and `predicateNot` when building time-locked vesting or refund windows so funds cannot be permanently stranded.
