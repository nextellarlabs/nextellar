/**
 * @jest-environment jsdom
 *
 * useAccountMerge (default template) unit tests (#1442).
 *
 * Exercises the real hook against a mocked Stellar SDK: happy-path XDR
 * building, explicit-confirm enforcement, every pre-flight blocker, and
 * Horizon failure mapping. Jest runs under real ESM here, so the SDK mock
 * uses jest.unstable_mockModule rather than jest.mock().
 */
import { jest } from "@jest/globals";
import {
  act,
  issuedBalance,
  nativeBalance,
  PUBLIC_KEY,
  PUBLIC_KEY_2,
  renderHook,
  USDC_ISSUER,
} from "../helpers";

const MockServer = jest.fn();
const MockTransactionBuilder = jest.fn();
const mockAccountMerge = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  TransactionBuilder: MockTransactionBuilder,
  Operation: { accountMerge: mockAccountMerge },
  Networks: { TESTNET, PUBLIC },
  BASE_FEE: "100",
}));

const { useAccountMerge } =
  await import("../../src/templates/default/src/hooks/useAccountMerge.js");

const UNSIGNED_XDR = "UNSIGNED".padEnd(64, "A");
const SOURCE_ACCOUNT = {
  accountId: () => PUBLIC_KEY,
  sequenceNumber: () => "5",
};

type AsyncFn = (...args: unknown[]) => Promise<unknown>;
type SafetyReport = {
  source: string;
  safe: boolean;
  blockers: Array<{
    type: string;
    message: string;
    details?: string[];
  }>;
};

function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

async function run<T>(
  fn: () => Promise<T>,
): Promise<{ value?: T; error?: unknown }> {
  let value: T | undefined;
  let error: unknown;
  await act(async () => {
    try {
      value = await fn();
    } catch (err) {
      error = err;
    }
  });
  return { value, error };
}

describe("useAccountMerge (default template)", () => {
  let mockAccountCall: jest.Mock<AsyncFn>;
  let mockOffersCall: jest.Mock<AsyncFn>;
  let mockAccountId: jest.Mock;
  let mockForAccount: jest.Mock;
  let mockLoadAccount: jest.Mock<AsyncFn>;
  let builder: {
    addOperation: jest.Mock;
    setTimeout: jest.Mock;
    build: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockAccountCall = jest.fn<AsyncFn>().mockResolvedValue({
      balances: [
        nativeBalance("5.0000000"),
        // A zero-balance trustline must not block the merge.
        issuedBalance("USDC", USDC_ISSUER, { balance: "0.0000000" }),
      ],
      num_sponsoring: 0,
      num_sponsored: 0,
    });
    mockOffersCall = jest.fn<AsyncFn>().mockResolvedValue({ records: [] });
    mockAccountId = jest.fn(() => ({ call: mockAccountCall }));
    mockForAccount = jest.fn(() => ({ call: mockOffersCall }));
    mockLoadAccount = jest.fn<AsyncFn>().mockResolvedValue(SOURCE_ACCOUNT);

    MockServer.mockImplementation(() => ({
      accounts: () => ({ accountId: mockAccountId }),
      offers: () => ({ forAccount: mockForAccount }),
      loadAccount: mockLoadAccount,
    }));

    builder = {
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({ toXDR: () => UNSIGNED_XDR })),
    };
    MockTransactionBuilder.mockImplementation(() => builder);
    mockAccountMerge.mockImplementation((opts: unknown) => ({
      type: "accountMerge",
      opts,
    }));
  });

  const params = (overrides: Record<string, unknown> = {}) => ({
    source: PUBLIC_KEY,
    destination: PUBLIC_KEY_2,
    confirm: true,
    ...overrides,
  });

  it("builds an accountMerge XDR on the happy path", async () => {
    const { result } = renderHook(() => useAccountMerge());
    const { value, error } = await run(() =>
      result.current.buildAccountMergeXDR(params()),
    );

    expect(error).toBeUndefined();
    expect(value).toBe(UNSIGNED_XDR);
    expect(MockServer).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org",
    );
    expect(mockAccountId).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(mockForAccount).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(mockLoadAccount).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(mockAccountMerge).toHaveBeenCalledWith({
      destination: PUBLIC_KEY_2,
    });
    expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
      fee: "100",
      networkPassphrase: TESTNET,
    });
    expect(builder.setTimeout).toHaveBeenCalledWith(30);
    expect(result.current.blockers).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("uses the PUBLIC network passphrase when configured", async () => {
    const { result } = renderHook(() => useAccountMerge({ network: "PUBLIC" }));
    const { error } = await run(() =>
      result.current.buildAccountMergeXDR(params()),
    );

    expect(error).toBeUndefined();
    expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
      fee: "100",
      networkPassphrase: PUBLIC,
    });
  });

  it("lists every blocker and never builds a blocked merge", async () => {
    mockAccountCall.mockResolvedValue({
      balances: [
        nativeBalance("5.0000000"),
        issuedBalance("USDC", USDC_ISSUER, { balance: "12.5000000" }),
      ],
      num_sponsoring: 1,
      num_sponsored: 2,
    });
    mockOffersCall.mockResolvedValue({
      records: [{ id: "offer-1" }, { id: "offer-2" }],
    });

    const { result } = renderHook(() => useAccountMerge());
    let report!: SafetyReport;
    await act(async () => {
      report = await result.current.checkSafety(PUBLIC_KEY);
    });

    expect(report.safe).toBe(false);
    expect(report.blockers.map((blocker) => blocker.type)).toEqual([
      "open-offers",
      "non-native-balance",
      "sponsored-entries",
    ]);
    expect(report.blockers[0].details).toEqual(["offer-1", "offer-2"]);
    expect(report.blockers[1].details).toEqual(["USDC: 12.5000000"]);
    expect(report.blockers[2].details).toEqual([
      "1 sponsored entry/entries created by this account",
      "2 entries sponsored by other accounts",
    ]);
    expect(result.current.blockers).toEqual(report.blockers);

    const { error } = await run(() =>
      result.current.buildAccountMergeXDR(params()),
    );
    expect((error as Error).message).toContain("Account merge blocked:");
    expect((error as Error).message).toContain(
      "Non-native asset balances must be zero before merging",
    );
    expect(mockAccountMerge).not.toHaveBeenCalled();
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("requires an explicit confirm flag before touching Horizon", async () => {
    const { result } = renderHook(() => useAccountMerge());
    const { error } = await run(() =>
      result.current.buildAccountMergeXDR(params({ confirm: false })),
    );

    expect((error as Error).message).toBe(
      "Explicit confirm: true is required to build an account merge transaction",
    );
    expect(mockAccountCall).not.toHaveBeenCalled();
    expect(mockOffersCall).not.toHaveBeenCalled();
    expect(mockAccountMerge).not.toHaveBeenCalled();
  });

  it("maps Horizon 5xx failures into a network error", async () => {
    mockAccountCall.mockRejectedValue(horizonError(503, "Service Unavailable"));
    const { result } = renderHook(() => useAccountMerge());
    const { error } = await run(() =>
      result.current.buildAccountMergeXDR(params()),
    );

    expect((error as Error).message).toBe("Network error: Service Unavailable");
    expect(result.current.error?.message).toBe(
      "Network error: Service Unavailable",
    );
    expect(result.current.blockers).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
