/**
 * @jest-environment jsdom
 *
 * useAccountData (default template) unit tests (#1441).
 *
 * Exercises the real hook in src/templates/default/src/hooks/useAccountData
 * against a mocked @stellar/stellar-sdk. Covers the fetch lifecycle
 * (loading, parsing data entries, empty/404/error states, refresh),
 * how buildSetDataXDR/buildRemoveDataXDR drive the SDK, and dev-only
 * signing + submission. Enforces 64-byte key/value limits.
 */
import { jest } from "@jest/globals";
import { act, PUBLIC_KEY, PUBLIC_KEY_2, renderHook, waitFor } from "../helpers";

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory can't be used here — jest.unstable_mockModule
// is the ESM-native equivalent. `../contexts` is resolved to the shared mock
// (see jest.config.mjs moduleNameMapper), whose useWalletConfig() returns
// undefined so the hook falls back to its default Horizon URL.
const MockServer = jest.fn();
const MockTransactionBuilder = jest.fn();
const MockTransaction = jest.fn();
const MockAsset = jest.fn();
const mockFromSecret = jest.fn();
const mockManageData = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  Keypair: { fromSecret: mockFromSecret },
  TransactionBuilder: MockTransactionBuilder,
  Operation: { manageData: mockManageData },
  Networks: { TESTNET, PUBLIC },
  Asset: MockAsset,
  BASE_FEE: "100",
  Transaction: MockTransaction,
  xdr: {},
}));

const { useAccountData } = await import("@/hooks/default/useAccountData");

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

describe("useAccountData (default template)", () => {
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

    mockAccountCall = jest.fn<AsyncFn>().mockResolvedValue({
      data: {
        config: "eyJ0aGVtZSI6ICJkYXJrIn0=", // base64 for '{"theme": "dark"}'
        version: "MQ==", // base64 for '1'
      },
    });
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
    mockManageData.mockImplementation((opts: unknown) => ({
      type: "manageData",
      opts,
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("fetching data entries", () => {
    it("stays idle and never reaches Horizon without a public key", async () => {
      const { result } = renderHook(() => useAccountData(undefined));

      expect(result.current.loading).toBe(false);
      expect(result.current.entries).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.refresh).toBe("function");
      expect(typeof result.current.buildSetDataXDR).toBe("function");
      expect(typeof result.current.buildRemoveDataXDR).toBe("function");
      expect(typeof result.current.submitSignedXDR).toBe("function");
      expect(typeof result.current.submitSetDataWithSecret).toBe("function");
      expect(typeof result.current.submitRemoveDataWithSecret).toBe("function");

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

      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));

      expect(result.current.loading).toBe(true);
      expect(result.current.entries).toEqual([]);

      await act(async () => {
        resolve({
          data: {
            config: "eyJ0aGVtZSI6ICJkYXJrIn0=",
            version: "MQ==",
          },
        });
      });
      expect(result.current.loading).toBe(false);
    });

    it("parses data entries from account.data and decodes base64 values", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(MockServer).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org",
      );
      expect(mockAccountId).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(result.current.error).toBeNull();
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries).toEqual([
        {
          key: "config",
          value: "eyJ0aGVtZSI6ICJkYXJrIn0=",
          valueDecoded: '{"theme": "dark"}',
        },
        {
          key: "version",
          value: "MQ==",
          valueDecoded: "1",
        },
      ]);
    });

    it("returns an empty list for an account with no data entries", async () => {
      mockAccountCall.mockResolvedValue({
        data: {},
      });

      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.entries).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("treats a 404 as an unfunded account rather than an error", async () => {
      mockAccountCall.mockRejectedValue(horizonError(404, "Not Found"));

      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.entries).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("surfaces a Horizon 5xx as a network error", async () => {
      mockAccountCall.mockRejectedValue(
        horizonError(503, "Service Unavailable"),
      );

      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Network error: Service Unavailable",
      );
      expect(result.current.entries).toEqual([]);
    });

    it("surfaces a Horizon 4xx as a client error with its status", async () => {
      mockAccountCall.mockRejectedValue(horizonError(400, "Bad Request"));

      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Client error: Bad Request (Status: 400)",
      );
    });

    it("rejects a malformed public key without querying Horizon", async () => {
      const { result } = renderHook(() => useAccountData("GSHORT"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error?.message).toBe(
        "Invalid Stellar public key format",
      );
      expect(mockAccountId).not.toHaveBeenCalled();
    });

    it("refresh() re-reads data entries from Horizon", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.entries).toHaveLength(2);

      mockAccountCall.mockResolvedValue({
        data: { newKey: "bmV3VmFsdWU=" }, // base64 for 'newValue'
      });
      await act(async () => {
        await result.current.refresh();
      });

      expect(mockAccountCall).toHaveBeenCalledTimes(2);
      expect(result.current.entries).toEqual([
        {
          key: "newKey",
          value: "bmV3VmFsdWU=",
          valueDecoded: "newValue",
        },
      ]);
    });

    it("refetches when the public key changes", async () => {
      const { result, rerender } = renderHook(
        ({ key }: { key: string }) => useAccountData(key),
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

  describe("buildSetDataXDR", () => {
    it("builds a manage-data operation with the provided key and value", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const xdr = await result.current.buildSetDataXDR("config", "new value");

      expect(xdr).toBe(UNSIGNED_XDR);
      expect(mockLoadAccount).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: TESTNET,
      });
      expect(mockManageData).toHaveBeenCalledWith({
        name: "config",
        value: "bmV3IHZhbHVl", // base64 for 'new value'
      });
      expect(builder.addOperation).toHaveBeenCalledWith(
        mockManageData.mock.results[0].value,
      );
      expect(builder.setTimeout).toHaveBeenCalledWith(30);
    });

    it("accepts Uint8Array values and encodes them to base64", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const bytes = new TextEncoder().encode("binary data");
      await result.current.buildSetDataXDR("binaryKey", bytes);

      expect(mockManageData).toHaveBeenCalledWith({
        name: "binaryKey",
        value: "YmluYXJ5IGRhdGE=", // base64 for 'binary data'
      });
    });

    it("uses the public network passphrase when configured", async () => {
      const { result } = renderHook(() =>
        useAccountData(PUBLIC_KEY, { network: "PUBLIC" }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      await result.current.buildSetDataXDR("key", "value");

      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: PUBLIC,
      });
    });

    it.each([
      ["", "Data key must be a non-empty string"],
      ["a".repeat(65), "Data key exceeds maximum length of 64 bytes"],
      ["key", "Data value exceeds maximum length of 64 bytes", "a".repeat(65)],
      ["key", "Data value must be provided", null],
      ["key", "Data value must be provided", undefined],
    ])(
      "rejects invalid key/value %j before contacting Horizon",
      async (key, message, value = "valid") => {
        const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(
          result.current.buildSetDataXDR(key, value as string | Uint8Array),
        ).rejects.toThrow(message);
        expect(mockLoadAccount).not.toHaveBeenCalled();
      },
    );

    it("requires a public key", async () => {
      const { result } = renderHook(() => useAccountData(null));

      await expect(
        result.current.buildSetDataXDR("key", "value"),
      ).rejects.toThrow("Public key required to build set data XDR");
    });

    it("maps a 404 on the source account to a funding hint", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404));
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        result.current.buildSetDataXDR("key", "value"),
      ).rejects.toThrow(
        `Account ${PUBLIC_KEY} not found. Account may need funding.`,
      );
    });
  });

  describe("buildRemoveDataXDR", () => {
    it("builds a manage-data operation with null value to remove the entry", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const xdr = await result.current.buildRemoveDataXDR("config");

      expect(xdr).toBe(UNSIGNED_XDR);
      expect(mockLoadAccount).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: TESTNET,
      });
      expect(mockManageData).toHaveBeenCalledWith({
        name: "config",
        value: null,
      });
      expect(builder.addOperation).toHaveBeenCalledWith(
        mockManageData.mock.results[0].value,
      );
      expect(builder.setTimeout).toHaveBeenCalledWith(30);
    });

    it("rejects invalid key before contacting Horizon", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        result.current.buildRemoveDataXDR("a".repeat(65)),
      ).rejects.toThrow("Data key exceeds maximum length of 64 bytes");
      expect(mockLoadAccount).not.toHaveBeenCalled();
    });

    it("requires a public key", async () => {
      const { result } = renderHook(() => useAccountData(null));

      await expect(result.current.buildRemoveDataXDR("key")).rejects.toThrow(
        "Public key required to build remove data XDR",
      );
    });
  });

  describe("submitSignedXDR", () => {
    it("submits a valid signed XDR and returns success with hash", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitSignedXDR(UNSIGNED_XDR);

      expect(MockTransaction).toHaveBeenCalledWith(UNSIGNED_XDR, TESTNET);
      expect(mockSubmitTransaction).toHaveBeenCalled();
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
                operations: ["op_bad_auth"],
              },
            },
          },
        },
      });
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitSignedXDR(UNSIGNED_XDR);

      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe("Transaction failed - tx_failed");
    });

    it("rejects malformed XDR before contacting Horizon", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(result.current.submitSignedXDR("INVALID")).rejects.toThrow(
        "Invalid signed transaction XDR",
      );
      expect(MockTransaction).not.toHaveBeenCalled();
    });
  });

  describe("submitSetDataWithSecret", () => {
    it("signs with the account keypair, submits and refreshes the list", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockAccountCall).toHaveBeenCalledTimes(1);

      let outcome!: Awaited<
        ReturnType<typeof result.current.submitSetDataWithSecret>
      >;
      await act(async () => {
        outcome = await result.current.submitSetDataWithSecret(
          "newKey",
          "newValue",
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
      expect(mockAccountCall).toHaveBeenCalledTimes(2); // refresh called
      expect(outcome).toEqual({
        success: true,
        hash: "tx_hash_123",
        raw: { hash: "tx_hash_123", successful: true },
      });
    });

    it("returns a failure when submission fails", async () => {
      mockSubmitTransaction.mockRejectedValue({
        message: "Request failed with status code 400",
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: "tx_failed",
                operations: ["op_no_data"],
              },
            },
          },
        },
      });
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitSetDataWithSecret(
        "key",
        "value",
        SECRET,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toBe("Transaction failed - tx_failed");
    });

    it("refuses a secret belonging to a different account", async () => {
      keypair.publicKey.mockReturnValue(PUBLIC_KEY_2);
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitSetDataWithSecret(
        "key",
        "value",
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
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        result.current.submitSetDataWithSecret("key", "value", "SHORT"),
      ).rejects.toThrow("Invalid secret key format");
      expect(mockFromSecret).not.toHaveBeenCalled();
    });
  });

  describe("submitRemoveDataWithSecret", () => {
    it("signs with the account keypair, submits and refreshes the list", async () => {
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockAccountCall).toHaveBeenCalledTimes(1);

      let outcome!: Awaited<
        ReturnType<typeof result.current.submitRemoveDataWithSecret>
      >;
      await act(async () => {
        outcome = await result.current.submitRemoveDataWithSecret(
          "config",
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
      expect(mockAccountCall).toHaveBeenCalledTimes(2); // refresh called
      expect(outcome).toEqual({
        success: true,
        hash: "tx_hash_123",
        raw: { hash: "tx_hash_123", successful: true },
      });
    });

    it("refuses a secret belonging to a different account", async () => {
      keypair.publicKey.mockReturnValue(PUBLIC_KEY_2);
      const { result } = renderHook(() => useAccountData(PUBLIC_KEY));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const outcome = await result.current.submitRemoveDataWithSecret(
        "config",
        SECRET,
      );

      expect(outcome).toEqual({
        success: false,
        error: "Secret key does not match the provided public key",
        raw: undefined,
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });
});
