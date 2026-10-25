# Cookbook: Deploying and Upgrading a Soroban Contract

This walkthrough combines `useContractDeploy` and `useContractUpgrade` into a
single end-to-end flow: deploy a contract, use it, then later upgrade its WASM
and extend its TTL. Each hook has its own unit tests, but this page shows how
they fit together in practice, since in a real app you deploy once and then
come back to upgrade/maintain the same contract over its lifetime.

---

## Overview

- `useContractDeploy` builds the transaction(s) to upload a contract's WASM
  and create a new instance of it (optionally invoking a constructor).
- `useContractUpgrade` builds transactions to invoke an already-deployed
  contract's `upgrade` entrypoint with a new WASM hash, and to extend the TTL
  of a contract's ledger entries.

Both hooks only **build unsigned transaction XDR** — they do not sign or
submit anything. You still need a wallet (or a `Keypair`, in a script/test
context) to sign the returned XDR and a way to submit it to the network
(e.g. `rpcServer.sendTransaction`).

---

## Step 1: Deploy the contract

```tsx
import { useContractDeploy } from 'nextellar/hooks';
import * as fs from 'fs';

function DeployPanel({ sourcePublicKey }: { sourcePublicKey: string }) {
  const { buildDeployXDR, loading, error } = useContractDeploy({
    network: 'TESTNET',
  });

  const [contractId, setContractId] = useState<string | null>(null);

  const deploy = async () => {
    const wasm = fs.readFileSync('./contracts/counter.wasm');

    const { deployXdr, contractId, wasmHash } = await buildDeployXDR({
      wasm,
      sourcePublicKey,
      // Optional: invoke a constructor right after deploy.
      // constructorInvoke: { functionName: 'init', args: [] },
    });

    // Sign `deployXdr` with the source account's wallet, then submit it.
    const signedXdr = await wallet.sign(deployXdr);
    await submitTransaction(signedXdr);

    setContractId(contractId);
    console.log('Deployed contract:', contractId, 'wasmHash:', wasmHash);
  };

  return (
    <div>
      <button onClick={deploy} disabled={loading}>
        {loading ? 'Deploying…' : 'Deploy Contract'}
      </button>
      {contractId && <p>Contract ID: {contractId}</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}
    </div>
  );
}
```

Save the resulting `contractId` — you'll need it for every future upgrade or
TTL extension of this same contract.

---

## Step 2 (later): Upgrade the deployed contract

Upgrading requires two things that are easy to forget:

1. The **new WASM must already be uploaded** to the network — `buildUpgradeXDR`
   only invokes the `upgrade` entrypoint with a hash, it does not upload WASM
   itself. Re-use `useContractDeploy`'s internal upload step, or call
   `rpcServer.uploadContractWasm` directly, to get the new hash.
2. The **deployed contract must implement an `upgrade` entrypoint**. This is a
   property of the contract's own source code, not something these hooks add.
   If the contract was deployed without one, the upgrade transaction will fail
   simulation with a "function not found" error — there's no way to upgrade an
   immutable contract after the fact.

```tsx
import { useContractUpgrade } from 'nextellar/hooks';
import { rpc } from '@stellar/stellar-sdk';

function UpgradePanel({ contractId }: { contractId: string }) {
  const { buildUpgradeXDR, buildExtendTtlXDR, loading, error } =
    useContractUpgrade({ contractId, network: 'TESTNET' });

  const upgrade = async () => {
    // 1. Upload the new WASM to get its hash (reuse the deploy hook's
    //    rpcServer, or call this directly against your Soroban RPC URL).
    const rpcServer = new rpc.Server('https://soroban-testnet.stellar.org');
    const newWasm = fs.readFileSync('./contracts/counter_v2.wasm');
    const newWasmHash = await rpcServer.uploadContractWasm(newWasm, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });

    // 2. Build the upgrade invocation against the already-deployed contract.
    const upgradeXdr = await buildUpgradeXDR(newWasmHash);

    // Sign with the account authorized to call `upgrade` on this contract,
    // then submit.
    const signedXdr = await wallet.sign(upgradeXdr);
    await submitTransaction(signedXdr);
  };

  return (
    <button onClick={upgrade} disabled={loading}>
      {loading ? 'Upgrading…' : 'Upgrade Contract'}
    </button>
  );
}
```

---

## Step 3 (maintenance): Extend the contract's TTL

Soroban ledger entries — both a contract's instance entry and its WASM code
entry — expire and must be periodically extended, or they become archived and
need to be restored before they can be used again. Extending TTL alongside an
upgrade (or on a schedule) avoids ever hitting an archived contract:

```tsx
const extendTtl = async () => {
  // ~30 days of ledgers at Stellar's ~5s average close time.
  const extendXdr = await buildExtendTtlXDR(500_000);

  const signedXdr = await wallet.sign(extendXdr);
  await submitTransaction(signedXdr);
};
```

`buildExtendTtlXDR` extends both the instance and WASM code entries in one
transaction, since both are needed for the contract to keep working.

---

## Putting it together

A typical lifecycle for a single contract:

1. **Deploy** with `useContractDeploy` → store `contractId`.
2. **Use** the contract from your app via `useSorobanContract(contractId)`.
3. **Upgrade**, when you ship a new contract version: upload the new WASM,
   then call `buildUpgradeXDR` from `useContractUpgrade({ contractId })`
   against the *same* `contractId` — the address never changes across
   upgrades, only the WASM it points to.
4. **Extend TTL** periodically (or right after an upgrade) with
   `buildExtendTtlXDR` so the contract's ledger entries don't expire.

---

## Best Practices & Tips

1. **Keep `contractId` around.** Deploying creates it once; every later
   upgrade/TTL call targets that same ID, not a new one.
2. **Upload WASM before upgrading.** `buildUpgradeXDR` assumes the new WASM's
   hash already exists on-chain — upload it first via
   `rpcServer.uploadContractWasm`.
3. **Confirm the contract supports upgrades before relying on this flow.** If
   you control the contract source, implement an `upgrade` entrypoint
   up front; if you don't, check with the contract's author.
4. **Use the same network/RPC URL across deploy and upgrade calls** — a
   contract deployed on testnet cannot be upgraded by a hook pointed at
   mainnet, even with the same `contractId` string.
