import {
  Account,
  Keypair,
  Operation,
  TransactionBuilder,
  rpc,
  type FeeBumpTransaction,
  type Transaction,
} from '@stellar/stellar-sdk';

/**
 * Soroban fee-bump and restore-footprint helpers.
 *
 * Wraps two RPC-adjacent flows that come up whenever a Soroban transaction
 * either underpays its resource fee or touches an archived (expired)
 * ledger entry — both cases the raw SDK supports, but only via several
 * manual steps that are easy to get wrong (fee headroom math, restore
 * preamble handling, XDR round-tripping for the outer fee-bump envelope).
 */

/**
 * Wraps `innerTx` in a fee-bump transaction paid for by `feeSource`.
 *
 * @param innerTx - The already-built (and typically already-signed) inner
 *   transaction to wrap. A fee-bump transaction's inner transaction must be
 *   fully formed first; only the fee-bump envelope itself gets signed after
 *   this call.
 * @param feeSource - The account paying the bumped fee. Does not need to be
 *   the same account that built/signed the inner transaction.
 * @param baseFee - **Per-operation** fee rate (in stroops, as a string) —
 *   not a total. The SDK computes the outer transaction's actual total fee
 *   as `baseFee * (innerTx.operations.length + 1) + resourceFee` (the `+1`
 *   covers the fee-bump envelope's own inclusion fee on top of the inner
 *   operations; `resourceFee` is carried over unchanged for a Soroban inner
 *   transaction). Must be at least the inner transaction's own per-operation
 *   fee rate and at least the network's `BASE_FEE` — the SDK throws a clear
 *   `Invalid baseFee, it should be at least N stroops` error otherwise, so
 *   this helper does not duplicate that check.
 * @param networkPassphrase - Network the transaction targets (e.g.
 *   `Networks.TESTNET`).
 * @returns An unsigned `FeeBumpTransaction`. Sign it (`.sign(feeSourceKeypair)`)
 *   and submit via `rpc.Server.sendTransaction` like any other transaction.
 *
 * @example
 * ```ts
 * // innerTx has 1 operation and a resourceFee of 0 → total outer fee = 1000 * 2 = 2000
 * const bumped = buildFeeBumpTransaction(innerTx, sponsorPublicKey, '1000', Networks.TESTNET);
 * bumped.sign(sponsorKeypair);
 * await server.sendTransaction(bumped);
 * ```
 */
export function buildFeeBumpTransaction(
  innerTx: Transaction,
  feeSource: string,
  baseFee: string,
  networkPassphrase: string,
): FeeBumpTransaction {
  return TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    baseFee,
    innerTx,
    networkPassphrase,
  );
}

/** Result of `simulateAndRestoreIfNeeded` when the entries needed restoring first. */
export interface RestoreResult {
  restored: true;
  /** The signed, submitted restore transaction's hash. */
  restoreTransactionHash: string;
}

/** Result of `simulateAndRestoreIfNeeded` when no restore was necessary. */
export interface NoRestoreNeeded {
  restored: false;
}

/**
 * Simulates `tx` and, if the simulation reports that some of the ledger
 * entries it touches have expired (archived) and need restoring first,
 * builds, signs, and submits the restore transaction — then simulation can
 * be retried by the caller against the now-restored state.
 *
 * This does **not** retry the original transaction itself; it only clears
 * the restore precondition. Callers should re-simulate (and re-build, since
 * the original transaction's sequence number is now stale) after a
 * successful restore.
 *
 * @param server - Soroban RPC client.
 * @param tx - The transaction to simulate.
 * @param restoreSourceAccount - Account that pays for and submits the
 *   restore transaction. Loaded fresh from `server` so its sequence number
 *   is current regardless of what `tx`'s own source account looked like.
 * @param signer - Keypair for `restoreSourceAccount`, used only to sign the
 *   restore transaction — never touches `tx` itself.
 * @param networkPassphrase - Network both transactions target.
 * @returns `{ restored: false }` if the simulation succeeded without needing
 *   a restore, or `{ restored: true, restoreTransactionHash }` once the
 *   restore transaction has been submitted and confirmed.
 * @throws If simulation fails for a reason other than needing a restore, or
 *   if the restore transaction itself fails or times out.
 */
export async function simulateAndRestoreIfNeeded(
  server: rpc.Server,
  tx: Transaction,
  restoreSourceAccount: string,
  signer: Keypair,
  networkPassphrase: string,
): Promise<RestoreResult | NoRestoreNeeded> {
  const simulation = await server.simulateTransaction(tx);

  if (!rpc.Api.isSimulationRestore(simulation)) {
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }
    return { restored: false };
  }

  const { minResourceFee, transactionData } = simulation.restorePreamble;

  const account = await server.getAccount(restoreSourceAccount);
  const restoreTx = new TransactionBuilder(account, {
    fee: minResourceFee,
    networkPassphrase,
  })
    .setSorobanData(transactionData.build())
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build();

  restoreTx.sign(signer);

  const sendResult = await server.sendTransaction(restoreTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Restore transaction failed to submit: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  const confirmed = await pollTransactionStatus(server, sendResult.hash);
  if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Restore transaction did not succeed: ${confirmed.status}`);
  }

  return { restored: true, restoreTransactionHash: sendResult.hash };
}

/**
 * Polls `server.getTransaction(hash)` until it leaves the `NOT_FOUND` state
 * (i.e. until the RPC node has indexed a result — success or failure) or
 * `timeoutMs` elapses.
 *
 * Exported separately from `simulateAndRestoreIfNeeded` since submit-then-poll
 * is a generally useful pattern beyond just the restore flow.
 *
 * @throws If `timeoutMs` elapses while still `NOT_FOUND`.
 */
export async function pollTransactionStatus(
  server: rpc.Server,
  hash: string,
  { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<rpc.Api.GetTransactionResponse> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await server.getTransaction(hash);
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for transaction ${hash} to be indexed after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Re-exported so callers building a restore/fee-bump flow end-to-end don't
// need a second import from '@stellar/stellar-sdk' just for account loading.
export type { Account };
