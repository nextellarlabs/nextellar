# Multi-Signature Transaction Guide

This walks through the full flow for a multi-signature transaction using the
`default` template's `useMultisigTransaction` hook and the underlying
`src/lib/multisig.ts` helpers: build an unsigned transaction, collect
signatures from the account's signers, check whether the threshold is met,
and submit.

`useMultisigTransaction` only tracks signatures against an account's signer
list and thresholds — it does not build the transaction itself, so you build
the unsigned XDR with `buildMultisigTransaction` (or any other builder) first,
then hand that XDR to the hook.

## 1. Load the account's signers and thresholds

`useMultisigTransaction` needs the transaction source account's Horizon
record shape — `thresholds` and `signers` — to know who can sign and how much
weight is required:

```ts
import { Horizon } from '@stellar/stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');
const account = await server.loadAccount(sourcePublicKey);
// account.thresholds -> { low_threshold, med_threshold, high_threshold }
// account.signers     -> [{ key, weight, type }, ...]
```

## 2. Build the unsigned transaction

```ts
import { Account, Asset, Networks, Operation } from '@stellar/stellar-sdk';
import { buildMultisigTransaction } from '@/lib/multisig';

const unsignedXdr = buildMultisigTransaction({
  source: new Account(account.id, account.sequence),
  operations: [
    Operation.payment({
      destination: 'GDEST...',
      asset: Asset.native(),
      amount: '10',
    }),
  ],
  networkPassphrase: Networks.TESTNET,
}).toXDR();
```

`thresholdLevelForOperation` (also exported from `lib/multisig.ts`) derives
which threshold level (`low`/`medium`/`high`) a transaction needs from its
operations — `useMultisigTransaction` applies this automatically unless you
override it via `load(transaction, { thresholdLevel })`.

## 3. Load the transaction into the hook and check the required weight

```tsx
import { Networks } from '@stellar/stellar-sdk';
import { useMultisigTransaction } from '@/hooks/useMultisigTransaction';

function MultisigApproval({ account, unsignedXdr }) {
  const multisig = useMultisigTransaction(account, Networks.TESTNET);

  useEffect(() => {
    multisig.load(unsignedXdr);
  }, [unsignedXdr]);

  // multisig.status.requiredWeight -> weight needed, at least 1
  // multisig.status.pendingSigners -> signers who haven't signed yet
  // ...
}
```

## 4. Collect signatures from each signer

Each signer signs their own copy of the same transaction. There are three
ways to merge a signature back into the session, depending on where the
signature comes from:

```ts
// A signer with a local Keypair (e.g. a test fixture, or a server-side signer)
multisig.signWith(aliceKeypair);

// A co-signer who signed their own copy of the XDR on a different device
// and sent back their full signed envelope
multisig.addSignedXdr(bobSignedXdr);

// A raw base64 signature from a signer, collected by some other means
// (e.g. a hardware wallet that only returns the signature, not a full XDR)
multisig.addSignature(signerPublicKey, signatureBase64);
```

Each call returns the updated `MultisigStatus` (or `null` on error — check
`multisig.error`), and `multisig.xdr` always reflects the envelope with every
signature collected so far.

## 5. Check the threshold and submit

```tsx
if (multisig.thresholdMet) {
  const tx = TransactionBuilder.fromXDR(multisig.xdr!, Networks.TESTNET);
  await server.submitTransaction(tx);
} else {
  // multisig.status.pendingSigners lists who's still needed
}
```

`thresholdMet` is `true` once the sum of valid signers' weights
(`signedWeight`) reaches `requiredWeight`. A threshold of `0` still needs at
least one valid signature — `requiredWeight` is always `max(threshold, 1)`.

## Signer types

Only these signer types are evaluated toward the threshold:

- `ed25519_public_key` — a signature whose hint matches and verifies against
  the transaction hash
- `preauth_tx` — counted automatically when the pre-authorized hash equals
  this transaction's hash (no signature needed)
- `sha256_hash` — counted when a submitted "signature" is the preimage of the
  signer's hash

`ed25519_signed_payload` signers are reported in `status.signers` (with
`supported: false`) but never counted toward the threshold — this hook
cannot verify that signer type.

## Starting over

```ts
multisig.reset();
```

Clears the loaded session, `status`, `xdr`, and `error`. Call `load()` again
to start tracking a new transaction.

## Limitation

Only the transaction's source account's signers are evaluated. If an
operation specifies a different `source` account, that account's own
signers/thresholds are not checked by this hook — handle those separately.

## Full example

See `tests/hooks/useMultisigTransaction.test.ts` for a complete, runnable
version of this flow (build → `load` → `signWith` + `addSignedXdr` →
`thresholdMet`), and `tests/lib/multisig.test.ts` for direct coverage of the
underlying session/threshold logic.
