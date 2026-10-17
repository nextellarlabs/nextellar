/**
 * @jest-environment jsdom
 *
 * useTrustlines (default template) unit tests (#1044).
 *
 * Exercises the real hook in src/templates/default/src/hooks/useTrustlines
 * — not a mocked stand-in — against a mocked @stellar/stellar-sdk, following
 * useStellarBalances.test.ts. Covers the fetch lifecycle (loading, parsing
 * balances into trustlines, empty/404/error states, refresh), how
 * buildChangeTrustXDR drives the SDK, and dev-only signing + submission. The
 * complementary useTrustlines.real.test.ts keeps the real SDK and checks the
 * XDR itself.
 */
import { jest } from "@jest/globals";
import {
  act,
  EURC_ISSUER,
  PUBLIC_KEY,
  PUBLIC_KEY_2,
  renderHook,
  SAMPLE_TRUSTLINE_BALANCES,
  SAMPLE_TRUSTLINES,
  USDC_ISSUER,
  waitFor,
} from "../helpers";

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory (which relies on babel's hoist-to-require
// transform) can't be used here — jest.unstable_mockModule is the
// ESM-native equivalent. `../contexts` is resolved to the shared mock (see
// jest.config.mjs moduleNameMapper), whose useWalletConfig() returns
// undefined so the hook falls back to its default Horizon URL.
const MockServer = jest.fn();
const MockTransactionBuilder = jest.fn();
const MockTransaction = jest.fn();
const MockAsset = jest.fn();
const mockFromSecret = jest.fn();
const mockChangeTrust = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  Keypair: { fromSecret: mockFromSecret },
  TransactionBuilder: MockTransactionBuilder,
  Operation: { changeTrust: mockChangeTrust },
  Networks: { TESTNET, PUBLIC },
  Asset: MockAsset,
  BASE_FEE: "100",
  Transaction: MockTransaction,
}));

const { useTrustlines } =
  await import("../../src/templates/default/src/hooks/useTrustlines.js");

// Shape-valid (56 chars, "S" prefix) but not a real key — Keypair is mocked.
const SECRET = "SENTINELTESTSECRET".padEnd(56, "X");
const UNSIGNED_XDR = "UNSIGNED".padEnd(64, "A");

const SOURCE_ACCOUNT = {
  accountId: () => PUBLIC_KEY,
  sequenceNumber: () => "5",
};

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

type Builder = {
  addOperation: jest.Mock;
  setTimeout: jest.Mock;
  build: jest.Mock;
};

function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

describe("useTrustlines (default template)", () => {
  let mockAccountId: jest.Mock;
  let mockAccountCall: jest.Mock<AsyncFn>;
  let mockLoadAccount: jest.Mock<AsyncFn>;
  let mockSubmitTransaction: jest.Mock<AsyncFn>;
  let builder: Builder;
  let keypair: { publicKey: jest.Mock };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockAccountCall = jest
      .fn<AsyncFn>()
      .mockResolvedValue({ balances: SAMPLE_TRUSTLINE_BALANCES });
    mockAccountId = jest.fn(() => ({ call: mockAccountCall }));
    mockLoadAccount = jest.fn<AsyncFn>().mockResolvedValue(SOURCE_ACCOUNT);
    mockSubmitTransaction = jest
      .fn<AsyncFn>()
      .mockResolvedValue({ hash: "tx_hash_123", successful: true });
    MockServer.mockImplementation(() => ({
      accounts: () => ({ accountId: mockAccountId }),
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));

    builder = {
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({ toXDR: () => UNSIGNED_XDR })),
    };
    MockTransactionBuilder.mockImplementation(() => builder);

    MockTransaction.mockImplementation((...args: unknown[]) => {
      const [xdr, passphrase] = args as [string, string];
      return { xdr, passphrase, sign: jest.fn() };
    });

    keypair = { publicKey: jest.fn(() => PUBLIC_KEY) };
    mockFromSecret.mockReturnValue(keypair);

    MockAsset.mockImplementation((...args: unknown[]) => {
      const [code, issuer] = args as [string, string];
      return { code, issuer };
    });
    mockChangeTrust.mockImplementation((opts: unknown) => ({
      type: "changeTrust",
      opts,
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("fetching trustlines", () => {
    it("stays idle and never reaches Horizon without a public key", async () => {
      const { result } = renderHook(() => useTrustlines(undefined));

      expect(result.current.loading).toBe(false);
      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.refresh).toBe("function");
      expect(typeof result.current.buildChangeTrustXDR).toBe("function");
      expect(typeof result.current.submitChangeTrustWithSecret).toBe(
        "function",
      );

      await act(async () => {
        await result.current.refresh();
      });
      expect(mockAccountId).not.toHaveBeenCalled();
    });

    it("is loading while the initial account fetch is in flight", async () => {
      let resolve!: (v: unknown) => void;
      mockAccountCall.mockImplementation(
        () =>
          new Promise((res) => {
            resolve = res;
          }),
      );

      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));

      expect(result.current.loading).toBe(true);
      expect(result.current.trustlines).toEqual([]);

      await act(async () => {
        resolve({ balances: SAMPLE_TRUSTLINE_BALANCES });
      });
      expect(result.current.loading).toBe(false);
    });

    it("parses non-native balances into trustlines and drops native XLM", async () => {
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(MockServer).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org",
      );
      expect(mockAccountId).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(result.current.error).toBeNull();
      // Balance lines use Horizon's `is_authorized`; the hook maps it to
      // `authorized` and leaves out the native XLM line entirely.
      expect(result.current.trustlines).toEqual(SAMPLE_TRUSTLINES);
    });

    it("returns an empty list for an account holding only native XLM", async () => {
      mockAccountCall.mockResolvedValue({
        balances: [{ asset_type: "native", balance: "1000.0000000" }],
      });

      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("treats a 404 as an unfunded account rather than an error", async () => {
      mockAccountCall.mockRejectedValue(horizonError(404, "Not Found"));

      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("surfaces a Horizon 5xx as a network error", async () => {
      mockAccountCall.mockRejectedValue(
        horizonError(503, "Service Unavailable"),
      );

      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Network error: Service Unavailable",
      );
      expect(result.current.trustlines).toEqual([]);
    });

    it("surfaces a Horizon 4xx as a client error with its status", async () => {
      mockAccountCall.mockRejectedValue(horizonError(400, "Bad Request"));

      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Client error: Bad Request (Status: 400)",
      );
    });

    it("rejects a malformed public key without querying Horizon", async () => {
      const { result } = renderHook(() => useTrustlines("GSHORT"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Invalid Stellar public key format",
      );
      expect(mockAccountId).not.toHaveBeenCalled();
    });

    it("refresh() re-reads trustlines from Horizon", async () => {
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.trustlines).toHaveLength(2);

      mockAccountCall.mockResolvedValue({
        balances: [SAMPLE_TRUSTLINE_BALANCES[1]],
      });
      await act(async () => {
        await result.current.refresh();
      });

      expect(mockAccountCall).toHaveBeenCalledTimes(2);
      expect(result.current.trustlines).toEqual([SAMPLE_TRUSTLINES[0]]);
    });

    it("refetches when the public key changes", async () => {
      const { result, rerender } = renderHook(
        ({ key }: { key: string }) => useTrustlines(key),
        { initialProps: { key: PUBLIC_KEY } },
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      rerender({ key: PUBLIC_KEY_2 });
      await waitFor(() =>
        expect(mockAccountId).toHaveBeenLastCalledWith(PUBLIC_KEY_2),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));
    });
  });

  describe("buildChangeTrustXDR", () => {
    it("builds a change-trust operation carrying the requested limit", async () => {
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const xdr = await result.current.buildChangeTrustXDR({
        code: "USDC",
        issuer: USDC_ISSUER,
        limit: "1000000",
      });

      expect(xdr).toBe(UNSIGNED_XDR);
      expect(mockLoadAccount).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(MockAsset).toHaveBeenCalledWith("USDC", USDC_ISSUER);
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: TESTNET,
      });
      expect(mockChangeTrust).toHaveBeenCalledWith({
        asset: { code: "USDC", issuer: USDC_ISSUER },
        limit: "1000000",
      });
      expect(builder.addOperation).toHaveBeenCalledWith(
        mockChangeTrust.mock.results[0].value,
      );
      expect(builder.setTimeout).toHaveBeenCalledWith(30);
    });

    it("omits the limit (SDK maximum) when none is given, on the public network", async () => {
      const { result } = renderHook(() =>
        useTrustlines(PUBLIC_KEY, { network: "PUBLIC" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.buildChangeTrustXDR({
        code: "EURC",
        issuer: EURC_ISSUER,
      });

      expect(mockChangeTrust).toHaveBeenCalledWith({
        asset: { code: "EURC", issuer: EURC_ISSUER },
      });
      expect(mockChangeTrust.mock.calls[0][0]).not.toHaveProperty("limit");
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: PUBLIC,
      });
    });

    it.each([
      [{ code: "", issuer: USDC_ISSUER }, "Invalid asset code"],
      [{ code: "TOO-LONG-CODE!", issuer: USDC_ISSUER }, "Invalid asset code"],
      [{ code: "USDC", issuer: "GBAD" }, "Invalid asset issuer"],
      [
        { code: "USDC", issuer: USDC_ISSUER, limit: "-1" },
        "Asset limit must be a positive number",
      ],
    ])(
      "rejects invalid asset %j before contacting Horizon",
      async (asset, message) => {
        const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(result.current.buildChangeTrustXDR(asset)).rejects.toThrow(
          message,
        );
        expect(mockLoadAccount).not.toHaveBeenCalled();
      },
    );

    it("requires a public key", async () => {
      const { result } = renderHook(() => useTrustlines(null));

      await expect(
        result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
        }),
      ).rejects.toThrow("Public key required to build change trust XDR");
    });

    it("maps a 404 on the source account to a funding hint", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404));
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
        }),
      ).rejects.toThrow(
        `Account ${PUBLIC_KEY} not found. Account may need funding.`,
      );
    });
  });

  describe("submitChangeTrustWithSecret", () => {
    it("signs with the account keypair, submits and refreshes the list", async () => {
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockAccountCall).toHaveBeenCalledTimes(1);

      let outcome!: Awaited<
        ReturnType<typeof result.current.submitChangeTrustWithSecret>
      >;
      await act(async () => {
        outcome = await result.current.submitChangeTrustWithSecret(
          UNSIGNED_XDR,
          SECRET,
        );
      });

      expect(mockFromSecret).toHaveBeenCalledWith(SECRET);
      expect(MockTransaction).toHaveBeenCalledWith(UNSIGNED_XDR, TESTNET);
      const transaction = MockTransaction.mock.results[0].value as {
        sign: jest.Mock;
      };
      expect(transaction.sign).toHaveBeenCalledWith(keypair);
      expect(mockSubmitTransaction).toHaveBeenCalledWith(transaction);
      expect(mockAccountCall).toHaveBeenCalledTimes(2);
      expect(outcome).toEqual({
        success: true,
        hash: "tx_hash_123",
        raw: { hash: "tx_hash_123", successful: true },
      });
    });

    it("returns a failure carrying Horizon's result codes", async () => {
      mockSubmitTransaction.mockRejectedValue({
        message: "Request failed with status code 400",
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: "tx_failed",
                operations: ["op_no_issuer"],
              },
            },
          },
        },
      });
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitChangeTrustWithSecret(
        UNSIGNED_XDR,
        SECRET,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe("Transaction failed - tx_failed");
      expect(mockAccountCall).toHaveBeenCalledTimes(1);
    });

    it("refuses a secret belonging to a different account", async () => {
      keypair.publicKey.mockReturnValue(PUBLIC_KEY_2);
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitChangeTrustWithSecret(
        UNSIGNED_XDR,
        SECRET,
      );

      expect(outcome).toEqual({
        success: false,
        error: "Secret key does not match the provided public key",
        raw: undefined,
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("throws on a malformed secret before touching the SDK", async () => {
      const { result } = renderHook(() => useTrustlines(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        result.current.submitChangeTrustWithSecret(UNSIGNED_XDR, "SHORT"),
      ).rejects.toThrow("Invalid secret key format");
      expect(mockFromSecret).not.toHaveBeenCalled();
    });
  });
});
