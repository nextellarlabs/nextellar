/**
 * @jest-environment jsdom
 *
 * useClaimableBalances (default template) unit tests.
 */
import { jest } from "@jest/globals";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { WalletContext } from "../../src/mocks/wallet-contexts-mock.js";
import { PUBLIC_KEY } from "../helpers/fixtures";

const MockServer = jest.fn();
const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockClaimableCall = jest.fn();
const mockClaimableBalances = jest.fn(() => ({
  forClaimant: jest.fn(() => ({ call: mockClaimableCall })),
}));
const MockTransactionBuilder = Object.assign(jest.fn(), {
  fromXDR: jest.fn(),
});
const mockClaimClaimableBalance = jest.fn();
const mockSignTransaction = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
const UNSIGNED_XDR = "UNSIGNED".padEnd(64, "A");
const SIGNED_XDR = "SIGNED".padEnd(64, "A");
const NOW = Date.parse("2026-01-01T00:00:00Z");
const LAST_MODIFIED = new Date(NOW - 30_000).toISOString();

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  BASE_FEE: "100",
  Horizon: { Server: MockServer },
  Networks: { TESTNET, PUBLIC },
  Operation: { claimClaimableBalance: mockClaimClaimableBalance },
  TransactionBuilder: MockTransactionBuilder,
}));

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit.ts",
  () => ({ signTransaction: mockSignTransaction }),
);

const { useClaimableBalances } =
  await import("../../src/templates/default/src/hooks/useClaimableBalances.js");

type WalletValue = Record<string, unknown>;

const makeWrapper =
  (wallet: WalletValue) =>
  ({ children }: { children: ReactNode }) =>
    createElement(WalletContext.Provider, { value: wallet }, children);

const claimableRecord = (
  id: string,
  predicate: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  asset: "USDC:GISSUER",
  amount: "12.5000000",
  sponsor: "GSPONSOR",
  last_modified_time: LAST_MODIFIED,
  claimants: [{ destination: PUBLIC_KEY, predicate }],
  ...overrides,
});

describe("useClaimableBalances (default template)", () => {
  let records: ReturnType<typeof claimableRecord>[];
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let wallet: WalletValue;
  let builder: {
    addOperation: jest.Mock;
    setTimeout: jest.Mock;
    build: jest.Mock;
  };
  let builtTransaction: { toXDR: jest.Mock };
  const submittedTransaction = { signed: true };

  const renderBalancesHook = (walletValue = wallet, options = {}) =>
    renderHook(() => useClaimableBalances(options), {
      wrapper: makeWrapper(walletValue),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    wallet = { connected: true, publicKey: PUBLIC_KEY };
    records = [
      claimableRecord("unconditional", {}),
      claimableRecord("native-asset", {}, { asset: "native" }),
      claimableRecord("absolute-future", {
        abs_before: new Date(NOW + 60_000).toISOString(),
      }),
      claimableRecord("absolute-past", {
        abs_before: new Date(NOW - 60_000).toISOString(),
      }),
      claimableRecord("absolute-epoch", {
        abs_before_epoch: Math.floor((NOW + 60_000) / 1000),
      }),
      claimableRecord("relative-future", { rel_before: "60" }),
      claimableRecord("relative-past", {
        rel_before: "10",
        last_modified_time: new Date(NOW - 60_000).toISOString(),
      }),
      claimableRecord("not-after-absolute", {
        not: { abs_before: new Date(NOW - 60_000).toISOString() },
      }),
      claimableRecord("not-after-relative", {
        not: { rel_before: "10" },
        last_modified_time: new Date(NOW - 60_000).toISOString(),
      }),
      claimableRecord("nested-and-or", {
        and: [
          { unconditional: true },
          {
            or: [
              { abs_before: new Date(NOW - 60_000).toISOString() },
              { not: { rel_before: "10" } },
            ],
          },
        ],
        last_modified_time: new Date(NOW - 60_000).toISOString(),
      }),
      claimableRecord(
        "other-claimant",
        { unconditional: true },
        {
          claimants: [
            { destination: "GANOTHER", predicate: { unconditional: true } },
          ],
        },
      ),
    ];
    mockClaimableCall.mockResolvedValue({ records });

    MockServer.mockImplementation(() => ({
      claimableBalances: mockClaimableBalances,
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));

    builder = {
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(),
    };
    builtTransaction = { toXDR: jest.fn(() => UNSIGNED_XDR) };
    builder.build.mockReturnValue(builtTransaction);
    MockTransactionBuilder.mockImplementation(() => builder);
    MockTransactionBuilder.fromXDR.mockReturnValue(submittedTransaction);
    mockLoadAccount.mockResolvedValue({ accountId: () => PUBLIC_KEY });
    mockSubmitTransaction.mockResolvedValue({ hash: "claim_tx_hash" });
    mockClaimClaimableBalance.mockImplementation((args: unknown) => ({
      type: "claimClaimableBalance",
      args,
    }));
    mockSignTransaction.mockResolvedValue(SIGNED_XDR);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("fetches and parses balance assets, sponsor, amount, and predicate availability", async () => {
    const { result } = renderBalancesHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(MockServer).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org",
    );
    expect(result.current.error).toBeNull();
    expect(result.current.balances[0]).toMatchObject({
      id: "unconditional",
      asset: "USDC:GISSUER",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GISSUER",
      amount: "12.5000000",
      sponsor: "GSPONSOR",
      isClaimable: true,
    });
    expect(result.current.balances[0].claimants).toEqual([
      {
        destination: PUBLIC_KEY,
        predicate: {},
        isClaimable: true,
      },
    ]);
    expect(result.current.balances[1]).toMatchObject({
      id: "native-asset",
      asset_type: "native",
      isClaimable: true,
    });
    expect(
      result.current.balances.map(({ id, isClaimable }) => [id, isClaimable]),
    ).toEqual([
      ["unconditional", true],
      ["native-asset", true],
      ["absolute-future", true],
      ["absolute-past", false],
      ["absolute-epoch", true],
      ["relative-future", true],
      ["relative-past", false],
      ["not-after-absolute", true],
      ["not-after-relative", true],
      ["nested-and-or", true],
      ["other-claimant", false],
    ]);
  });

  it("builds, signs, submits, and refreshes a claimable balance transaction", async () => {
    const { result } = renderBalancesHook(undefined, { network: "PUBLIC" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let response: unknown;
    await act(async () => {
      response = await result.current.claimBalance("unconditional");
    });

    expect(mockLoadAccount).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(MockTransactionBuilder).toHaveBeenCalledWith(expect.anything(), {
      fee: "100",
      networkPassphrase: PUBLIC,
    });
    expect(mockClaimClaimableBalance).toHaveBeenCalledWith({
      balanceId: "unconditional",
    });
    expect(builder.setTimeout).toHaveBeenCalledWith(30);
    expect(mockSignTransaction).toHaveBeenCalledWith({
      unsignedTransaction: UNSIGNED_XDR,
      address: PUBLIC_KEY,
    });
    expect(MockTransactionBuilder.fromXDR).toHaveBeenCalledWith(
      SIGNED_XDR,
      PUBLIC,
    );
    expect(mockSubmitTransaction).toHaveBeenCalledWith(submittedTransaction);
    expect(response).toEqual({ hash: "claim_tx_hash" });
    expect(mockClaimableCall).toHaveBeenCalledTimes(2);
  });

  it("surfaces a Horizon error when fetching balances", async () => {
    MockServer.mockImplementation(() => ({
      claimableBalances: () => ({
        forClaimant: () => ({
          call: jest.fn().mockRejectedValue(new Error("Horizon unavailable")),
        }),
      }),
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));

    const { result } = renderBalancesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toBe("Horizon unavailable");
    expect(result.current.balances).toEqual([]);
  });

  it("refuses to claim a balance whose predicate is not currently satisfied", async () => {
    const { result } = renderBalancesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.claimBalance("absolute-past")).rejects.toThrow(
      "Claimable balance is not currently claimable",
    );
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it("surfaces a wallet signing rejection without submitting", async () => {
    mockSignTransaction.mockRejectedValue(new Error("User rejected signing"));
    const { result } = renderBalancesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.claimBalance("unconditional"),
      ).rejects.toThrow("User rejected signing");
    });
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe("User rejected signing");
  });

  it("surfaces a Horizon submission failure", async () => {
    mockSubmitTransaction.mockRejectedValue(new Error("Submission failed"));
    const { result } = renderBalancesHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(
        result.current.claimBalance("unconditional"),
      ).rejects.toThrow("Submission failed");
    });
    expect(result.current.error?.message).toBe("Submission failed");
  });

  it("clears balances and rejects claims while the wallet is disconnected", async () => {
    const { result } = renderBalancesHook({
      connected: false,
      publicKey: undefined,
    });

    expect(result.current.balances).toEqual([]);
    expect(result.current.loading).toBe(false);
    await expect(result.current.claimBalance("unconditional")).rejects.toThrow(
      "Wallet not connected",
    );
    expect(mockClaimableBalances).not.toHaveBeenCalled();
  });
});
