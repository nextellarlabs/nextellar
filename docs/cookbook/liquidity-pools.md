# Cookbook: Liquidity Pools (Deposit & Withdraw)

Stellar's built-in AMM is a set of *constant-product* liquidity pools. A pool
holds reserves of two assets and mints **pool shares** to liquidity providers;
traders swap against those reserves through path payments, paying a 0.3% fee
that accrues to the share holders.

Depositing and withdrawing is not covered by a dedicated hook, so this recipe
builds the two operations with `@stellar/stellar-sdk` and hands the signed
envelope to the template hooks:

- `useStellarWallet` — connect a wallet, get the address, read share balances.
- `useStellarPayment` — `submitSignedXDR`, which decodes Horizon result codes.
- `signTransaction` from `src/lib/stellar-wallet-kit.ts` — sign with the
  connected wallet.
- `useTrustlines` — inspect existing trustlines (pool shares need their own
  one, though, which is built by hand because `buildChangeTrustXDR` only takes
  a `{ code, issuer }` asset).

---

## Overview

| Step | Operation | Notes |
| --- | --- | --- |
| Derive pool ID | — | Deterministic: `getLiquidityPoolId('constant_product', { assetA, assetB, fee: 30 })`. |
| Read the pool | Horizon `liquidityPools()` | Reserves, `total_shares`, `fee_bp`. |
| Trust the shares | `changeTrust` with a `LiquidityPoolAsset` | Required before depositing **and** before withdrawing. |
| Deposit | `liquidityPoolDeposit` | `maxAmountA`, `maxAmountB`, `minPrice`, `maxPrice`. |
| Withdraw | `liquidityPoolWithdraw` | `amount` (shares), `minAmountA`, `minAmountB`. |

Pool IDs are deterministic and only one pool can exist per asset pair, so the
ID can be computed locally instead of being looked up. The two assets **must be
in lexicographic order** (`Asset.compare(assetA, assetB) === -1`), otherwise
the SDK throws `Assets are not in lexicographic order`. XLM sorts before issued
assets, so in an XLM/USDC pool `assetA` is XLM.

---

## Step 1: Derive the pool ID and read its state

```ts
import {
  Asset,
  Horizon,
  LiquidityPoolAsset,
  LiquidityPoolFeeV18,
  getLiquidityPoolId,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_URL);

const XLM = Asset.native();
const USDC = new Asset(
  'USDC',
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
);

/** Sort two assets the way a constant-product pool expects them. */
function orderedPoolAssets(first: Asset, second: Asset): [Asset, Asset] {
  return Asset.compare(first, second) === -1
    ? [first, second]
    : [second, first];
}

const [assetA, assetB] = orderedPoolAssets(XLM, USDC);

// A LiquidityPoolAsset is the *pool share* asset, not one of the reserves.
const poolShareAsset = new LiquidityPoolAsset(
  assetA,
  assetB,
  LiquidityPoolFeeV18, // 30 = 0.3%; the only fee the protocol supports
);

const poolId = getLiquidityPoolId(
  'constant_product',
  poolShareAsset.getLiquidityPoolParameters(),
).toString('hex'); // 64 hex characters

type PoolState = {
  poolId: string;
  feeBp: number;
  totalShares: string;
  reserveA: string;
  reserveB: string;
};

async function loadPool(poolId: string): Promise<PoolState | null> {
  try {
    const record = await horizon.liquidityPools().liquidityPoolId(poolId).call();

    // `reserves` is ordered the same way as the pool's assets (A first).
    return {
      poolId: record.id,
      feeBp: record.fee_bp,
      totalShares: record.total_shares,
      reserveA: record.reserves[0]?.amount ?? '0',
      reserveB: record.reserves[1]?.amount ?? '0',
    };
  } catch (err) {
    // A pool that has never been funded does not exist on Horizon yet.
    if ((err as { response?: { status?: number } }).response?.status === 404) {
      return null;
    }
    throw err;
  }
}
```

`loadPool` returns `null` for a pool that has never been funded. A pool is
created by its first deposit — there is no separate "create pool" operation.

You can also look pools up by their assets:

```ts
const page = await horizon
  .liquidityPools()
  .forAssets(assetA, assetB)
  .call();
```

---

## Step 2: Trust the pool shares

Pool shares are their own asset (`asset_type: 'liquidity_pool_shares'`), and
they need a trustline before the account can hold them. A trustline for the
underlying reserves is **not** enough, and vice versa:

```ts
import { BASE_FEE, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

async function buildPoolShareTrustXDR(publicKey: string, limit?: string) {
  const account = await horizon.loadAccount(publicKey);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset: poolShareAsset,
        // Optional. Defaults to the maximum (unlimited) trustline limit.
        ...(limit ? { limit } : {}),
      }),
    )
    .setTimeout(30)
    .build();

  return transaction.toXDR();
}
```

Each trustline costs one base reserve, and it stays locked until the trustline
is removed (a `changeTrust` with `limit: '0'`, which is only allowed once the
share balance is zero — i.e. after withdrawing everything).

If the trustline is missing, the network rejects a deposit with
`op_liquidity_pool_deposit_no_trust` and a withdrawal with
`op_liquidity_pool_withdraw_no_trust`.

---

## Step 3: Deposit

`liquidityPoolDeposit` takes **maximum** amounts for each reserve plus a price
window, and converts them into pool shares:

- `maxAmountA` / `maxAmountB` — ceilings, ordered like the pool's assets.
- `minPrice` / `maxPrice` — bounds on the deposit price, expressed as
  **`depositA / depositB`** (units of A per unit of B). This is the inverse of
  how a pair like XLM/USDC is often quoted in a UI, so build the price from the
  reserves rather than from a display quote.
- The actual amounts deposited are `shares / total_shares` of each reserve, so
  they can be slightly below the maximums. The difference stays in the account.

```ts
function applySlippage(value: number, slippageBps: number) {
  return (value * (10_000 - slippageBps)) / 10_000;
}

type DepositQuote = {
  maxAmountA: string;
  maxAmountB: string;
  minPrice: number;
  maxPrice: number;
  expectedShares: string;
  price: number; // depositA / depositB
};

function quoteDeposit(
  pool: PoolState,
  amountA: string,
  slippageBps: number,
): DepositQuote {
  const reserveA = Number(pool.reserveA);
  const reserveB = Number(pool.reserveB);
  const totalShares = Number(pool.totalShares);

  // For an existing pool, the deposit must match the current reserve ratio,
  // so amount B follows from amount A.
  const amountB = (Number(amountA) * reserveB) / reserveA;
  const price = amountA ? Number(amountA) / amountB : 0;

  // Shares are minted in proportion to the deposit relative to the reserves.
  const expectedShares = totalShares
    ? ((Number(amountA) / reserveA) * totalShares).toFixed(7)
    : amountA;

  return {
    // Add a small buffer so rounding never makes the operation underfunded.
    maxAmountA: (Number(amountA) * 1.01).toFixed(7),
    maxAmountB: (amountB * 1.01).toFixed(7),
    minPrice: applySlippage(price, slippageBps),
    maxPrice: (price * (10_000 + slippageBps)) / 10_000,
    expectedShares,
    price,
  };
}

async function buildDepositXDR(
  publicKey: string,
  pool: PoolState,
  quote: DepositQuote,
) {
  const account = await horizon.loadAccount(publicKey);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.liquidityPoolDeposit({
        liquidityPoolId: pool.poolId,
        maxAmountA: quote.maxAmountA,
        maxAmountB: quote.maxAmountB,
        minPrice: quote.minPrice,
        maxPrice: quote.maxPrice,
      }),
    )
    .setTimeout(30)
    .build();

  return transaction.toXDR();
}
```

Notes:

- The price window protects against the pool ratio moving between your quote
  and your signature. If the required deposit price falls outside it, the
  transaction fails with `op_liquidity_pool_deposit_under_minimum` rather than
  filling at a worse rate.
- For the **first** deposit the pool is empty, so there is no ratio to match:
  `maxAmountA` / `maxAmountB` set the initial price. `minPrice` / `maxPrice`
  are still required by the operation but cannot be violated by an empty pool.
- `minPrice` and `maxPrice` are converted to rationals with up to 7 decimal
  places and must be greater than zero; a price of `0` or a non-finite value
  throws before the transaction is built.
- Deposit both assets in the current ratio. Sending an unbalanced pair is not
  "one-sided liquidity": the operation still pulls both reserves, and only the
  prices bound how much.

---

## Step 4: Withdraw

Withdrawals are share-denominated. The payout is pro-rata — `amount /
total_shares` of each reserve — and `minAmountA` / `minAmountB` bound how much
slippage you accept on the way out:

```ts
type WithdrawQuote = {
  amount: string;
  minAmountA: string;
  minAmountB: string;
  expectedA: string;
  expectedB: string;
};

function quoteWithdraw(
  pool: PoolState,
  shares: string,
  slippageBps: number,
): WithdrawQuote {
  const shareFraction = Number(shares) / Number(pool.totalShares);
  const expectedA = shareFraction * Number(pool.reserveA);
  const expectedB = shareFraction * Number(pool.reserveB);

  return {
    amount: shares,
    expectedA: expectedA.toFixed(7),
    expectedB: expectedB.toFixed(7),
    // The pool rounds in its own favour by at most 1 stroop per asset, so a
    // tolerance based on the pro-rata estimate is enough.
    minAmountA: applySlippage(expectedA, slippageBps).toFixed(7),
    minAmountB: applySlippage(expectedB, slippageBps).toFixed(7),
  };
}

async function buildWithdrawXDR(
  publicKey: string,
  pool: PoolState,
  quote: WithdrawQuote,
) {
  const account = await horizon.loadAccount(publicKey);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.liquidityPoolWithdraw({
        liquidityPoolId: pool.poolId,
        amount: quote.amount,
        minAmountA: quote.minAmountA,
        minAmountB: quote.minAmountB,
      }),
    )
    .setTimeout(30)
    .build();

  return transaction.toXDR();
}
```

Withdrawal failures worth handling explicitly:

| Result code | Cause |
| --- | --- |
| `op_liquidity_pool_withdraw_no_trust` | Missing pool-share trustline, or a reserve trustline was removed. |
| `op_liquidity_pool_withdraw_underfunded` | More shares than the account holds. |
| `op_liquidity_pool_withdraw_line_full` | Payout would exceed a reserve's trustline limit. |
| `op_liquidity_pool_withdraw_under_minimum` | Payout fell below `minAmountA` / `minAmountB`. |

The payout lands in the account as ordinary reserve balances; the shares are
burned.

---

## Step 5: Read the position

Share balances come back on the account's balance lines, so
`useStellarWallet`'s `balances` (or `Horizon.Server.loadAccount`) already has
everything needed:

```ts
const shares = balances.find(
  (balance) =>
    balance.asset_type === 'liquidity_pool_shares' &&
    'liquidity_pool_id' in balance &&
    balance.liquidity_pool_id === poolId,
);
```

`Number(shares?.balance ?? 0) / Number(pool.totalShares)` is the account's
fraction of the pool; the withdrawal estimate above is that fraction applied to
each reserve.

---

## Price bounds and risks

**Set real price bounds, don't widen them to "make it pass".** The deposit price
window and the withdraw minimums are the only slippage protection on these two
operations. A pool ratio can move between quote and submission (someone else
deposits, withdraws or swaps), and a value extracted by a sandwich around your
transaction shows up as a worse price. If the transaction fails on the bounds,
re-quote — retrying with a wider window is how you get filled at a bad rate.

**Divergence (impermanent) loss.** LPs hold a basket that rebalances as traders
swap, so when the relative price of the two assets moves, the position is worth
less than simply holding the deposited amounts. For a constant-product pool the
loss versus holding, for a price ratio change of `r`, is
`1 - 2·√r / (1 + r)` — about 0.6% for a 10% move, 5.7% for a 2× move. Fees
accrued (`fee_bp` × volume) have to exceed that for the position to win.

**Fee income is not a yield guarantee.** The 0.3% fee is taken from swaps
against the pool. A pool with little volume earns little, and a pool with high
volume usually means more arbitrage against the reserves.

**Trustlines and reserves.** Holding a position requires a pool-share trustline
(one base reserve), plus trustlines for both reserve assets before withdrawing
them. A `line_full` error means the payout would push a reserve balance over its
trustline limit — raise the limit first.

**Issuer risk.** Issued assets are only as good as their issuer: an issuer can
freeze a trustline (`setTrustLineFlags`), revoke authorization, or claw back
balances. That risk applies to a share of the pool exactly as it does to a
wallet balance.

**One pool per pair.** A pool is identified by its two assets and the 30 bp fee.
You cannot create a second constant-product pool for the same pair, and you
can't change the fee; different fee tiers are not part of this AMM.

**Rounding favors the pool.** Share minting and payout round against the
depositor/withdrawer by at most one stroop per asset. Use `toFixed(7)` and a
slight tolerance on minimums instead of exact equality.

---

## Best Practices & Tips

1. **Derive the pool ID deterministically** with `getLiquidityPoolId` and sort
   the assets with `Asset.compare` first; a reversed pair produces a different
   (nonexistent) pool ID and confusing `404`s.
2. **Create the share trustline in its own transaction** before depositing.
   You can batch `changeTrust` and `liquidityPoolDeposit` (order matters, trust
   first), but a wallet prompt that both creates a trustline and moves funds is
   harder for users to review.
3. **Quote from on-chain reserves, not a cached display price**, and re-quote
   right before signing; both bounds are only meaningful if the quote is fresh.
4. **Treat `minPrice` / `maxPrice` as `A/B`.** For an XLM/USDC pool with XLM as
   `assetA`, the price is XLM per USDC, the inverse of the usual display quote.
5. **Refresh balances after every operation** with `refreshBalances()` from
   `useStellarWallet` — shares are balance lines, so the position and both
   reserve balances update together.
6. **Surface Horizon result codes.** `submitSignedXDR` decodes them; show the
   specific `op_liquidity_pool_*` code instead of a generic "transaction
   failed", because the fix differs (`no_trust` → add a trustline, `line_full`
   → raise a limit, `under_minimum` → re-quote).
