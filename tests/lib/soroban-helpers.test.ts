/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";
// Imported from the default template's own nested node_modules, not the
// root package's @stellar/stellar-sdk — the two are pinned to different
// major versions (root ^12.0.0, template ^14.4.3; see PR description).
// soroban-helpers.ts itself resolves the template's copy since it lives
// under src/templates/default/, so its Transaction/Asset/etc. classes are
// only instanceof-compatible with fixtures built from that same copy — a
// real generated app only ever has one installed copy, so this mismatch is
// specific to this dual-node_modules test topology, not a real-world issue.
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
  SorobanDataBuilder,
} from "../../src/templates/default/node_modules/@stellar/stellar-sdk";
import {
  buildFeeBumpTransaction,
  simulateAndRestoreIfNeeded,
  pollTransactionStatus,
} from "../../src/templates/default/src/lib/soroban-helpers";

const SOURCE_KEYPAIR = Keypair.random();
const FEE_SOURCE_KEYPAIR = Keypair.random();

function buildInnerTx(fee = "100") {
  const account = new Account(SOURCE_KEYPAIR.publicKey(), "0");
  return new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: FEE_SOURCE_KEYPAIR.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
}

describe("buildFeeBumpTransaction (#923)", () => {
  it("wraps the inner transaction in a fee-bump envelope with the correct total fee", () => {
    const inner = buildInnerTx("100");

    // 1 inner operation, no Soroban resource fee: total = baseFee * (1 + 1).
    const bumped = buildFeeBumpTransaction(
      inner,
      FEE_SOURCE_KEYPAIR.publicKey(),
      "1000",
      Networks.TESTNET,
    );

    expect(bumped.innerTransaction.hash().equals(inner.hash())).toBe(true);
    expect(bumped.feeSource).toBe(FEE_SOURCE_KEYPAIR.publicKey());
    expect(bumped.fee).toBe("2000");
  });

  it("propagates the SDK error when baseFee is below the inner transaction rate", () => {
    // buildInnerTx('1000') has 1 operation, so its own per-operation rate is
    // 1000. A fee-bump baseFee below that is invalid — the underlying SDK
    // call throws its own descriptive error, which this helper does not
    // wrap or swallow.
    const inner = buildInnerTx("1000");

    expect(() =>
      buildFeeBumpTransaction(
        inner,
        FEE_SOURCE_KEYPAIR.publicKey(),
        "500",
        Networks.TESTNET,
      ),
    ).toThrow(/Invalid baseFee/i);
  });

  it("produces a transaction signable by the fee source", () => {
    const inner = buildInnerTx("100");
    const bumped = buildFeeBumpTransaction(
      inner,
      FEE_SOURCE_KEYPAIR.publicKey(),
      "1000",
      Networks.TESTNET,
    );

    expect(() => bumped.sign(FEE_SOURCE_KEYPAIR)).not.toThrow();
    expect(bumped.signatures.length).toBe(1);
  });
});

describe("simulateAndRestoreIfNeeded (#923)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns restored:false when simulation succeeds without needing a restore", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvVoid() },
    } as never);

    const tx = buildInnerTx();
    const result = await simulateAndRestoreIfNeeded(
      server,
      tx,
      FEE_SOURCE_KEYPAIR.publicKey(),
      FEE_SOURCE_KEYPAIR,
      Networks.TESTNET,
    );

    expect(result).toEqual({ restored: false });
  });

  it("throws when simulation fails for a reason other than needing a restore", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      error: "host invocation failed",
    } as never);

    const tx = buildInnerTx();
    await expect(
      simulateAndRestoreIfNeeded(
        server,
        tx,
        FEE_SOURCE_KEYPAIR.publicKey(),
        FEE_SOURCE_KEYPAIR,
        Networks.TESTNET,
      ),
    ).rejects.toThrow(/simulation failed/i);
  });

  it("builds, signs, and submits a restore transaction when the simulation asks for one", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");

    const sorobanData = new SorobanDataBuilder();
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      // isSimulationRestore() requires a top-level transactionData (the
      // same field isSimulationSuccess checks for) in addition to
      // restorePreamble — this matches the real RPC response shape for a
      // "succeeded but has expired ledger entries" simulation.
      transactionData: sorobanData,
      restorePreamble: {
        minResourceFee: "5000",
        transactionData: sorobanData,
      },
    } as never);

    jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(
        new Account(FEE_SOURCE_KEYPAIR.publicKey(), "41") as never,
      );

    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "restore-tx-hash",
    } as never);

    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never);

    const tx = buildInnerTx();
    const result = await simulateAndRestoreIfNeeded(
      server,
      tx,
      FEE_SOURCE_KEYPAIR.publicKey(),
      FEE_SOURCE_KEYPAIR,
      Networks.TESTNET,
    );

    expect(result).toEqual({
      restored: true,
      restoreTransactionHash: "restore-tx-hash",
    });
  });

  it("throws when the restore transaction fails to submit", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const sorobanData = new SorobanDataBuilder();

    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      transactionData: sorobanData,
      restorePreamble: { minResourceFee: "5000", transactionData: sorobanData },
    } as never);
    jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(
        new Account(FEE_SOURCE_KEYPAIR.publicKey(), "41") as never,
      );
    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "ERROR",
      errorResult: { code: "tx_bad_seq" },
    } as never);

    const tx = buildInnerTx();
    await expect(
      simulateAndRestoreIfNeeded(
        server,
        tx,
        FEE_SOURCE_KEYPAIR.publicKey(),
        FEE_SOURCE_KEYPAIR,
        Networks.TESTNET,
      ),
    ).rejects.toThrow(/failed to submit/i);
  });

  it("throws when the restore transaction does not succeed", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const sorobanData = new SorobanDataBuilder();

    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      transactionData: sorobanData,
      restorePreamble: { minResourceFee: "5000", transactionData: sorobanData },
    } as never);
    jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(
        new Account(FEE_SOURCE_KEYPAIR.publicKey(), "41") as never,
      );
    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash: "restore-tx-hash",
    } as never);
    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    } as never);

    const tx = buildInnerTx();
    await expect(
      simulateAndRestoreIfNeeded(
        server,
        tx,
        FEE_SOURCE_KEYPAIR.publicKey(),
        FEE_SOURCE_KEYPAIR,
        Networks.TESTNET,
      ),
    ).rejects.toThrow(/did not succeed/i);
  });
});

describe("pollTransactionStatus (#923)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns immediately once the status leaves NOT_FOUND", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never);

    const result = await pollTransactionStatus(server, "some-hash");
    expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS);
  });

  it("polls until the status resolves, then returns it", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const spy = jest.spyOn(rpc.Server.prototype, "getTransaction");
    spy
      .mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)
      .mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)
      .mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      } as never);

    const result = await pollTransactionStatus(server, "some-hash", {
      intervalMs: 1,
    });
    expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("throws once timeoutMs elapses while still NOT_FOUND", async () => {
    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    } as never);

    await expect(
      pollTransactionStatus(server, "some-hash", {
        timeoutMs: 5,
        intervalMs: 2,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
