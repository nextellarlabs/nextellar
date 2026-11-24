# Nextellar Cookbook

Worked, copy-pasteable examples that combine the hooks shipped with the
Nextellar templates into real app flows. Each recipe assumes a generated app
(`npx nextellar`) and imports hooks from `nextellar/hooks`; helper modules are
imported from the generated app's `src/lib`.

| Recipe | What it covers |
| --- | --- |
| [Sending payments](./useStellarPayment.md) | XLM and issued-asset payments, status handling, memos. |
| [Claimable balances](./claimable-balances.md) | Creating and claiming claimable balances with `Claimant` predicates and escrow/refund windows. |
| [Reading and writing Soroban contracts](./useSorobanContract.md) | Type-safe contract reads, writes and simulation. |
| [Deploying and upgrading a Soroban contract](./contract-deploy-and-upgrade.md) | End-to-end lifecycle: deploy, invoke, upgrade WASM, extend TTL. |

Looking for the full hook signatures rather than a walkthrough? See
[docs/hooks.md](../hooks.md).
