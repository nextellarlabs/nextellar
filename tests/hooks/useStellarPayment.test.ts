/**
 * @jest-environment jsdom
 *
 * useStellarPayment (default template) unit tests (#1044).
 *
 * Exercises the real hook in src/templates/default/src/hooks/useStellarPayment
 * — not a mocked stand-in — against a mocked @stellar/stellar-sdk, following
 * useStellarBalances.test.ts. Asserts how the hook drives the SDK (source
 * account load, builder options, payment operation, memo, signing, submission)
 * and how it validates input and maps Horizon failures. The complementary
 * useStellarPayment.real.test.ts keeps the real SDK and checks the XDR itself.
 */
import { jest } from "@jest/globals";
import {
  EURC_ISSUER,
  PAYMENT_DESTINATION,
  PUBLIC_KEY,
  renderHook,
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
const MockAsset = Object.assign(jest.fn(), { native: jest.fn() });
const mockFromSecret = jest.fn();
const mockPayment = jest.fn();
const mockMemoText = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  Keypair: { fromSecret: mockFromSecret },
  TransactionBuilder: MockTransactionBuilder,
  Operation: { payment: mockPayment },
  Networks: { TESTNET, PUBLIC },
  Asset: MockAsset,
  Memo: { text: mockMemoText },
  BASE_FEE: "100",
  Transaction: MockTransaction,
}));

const { useStellarPayment } =
  await import("../../src/templates/default/src/hooks/useStellarPayment.js");

const FROM = PUBLIC_KEY;
const TO = PAYMENT_DESTINATION;
// Shape-valid (56 chars, "S" prefix) but not a real key — Keypair is mocked.
const SECRET = "SENTINELTESTSECRET".padEnd(56, "X");
// Base64-alphabet strings longer than the 50 chars submitSignedXDR requires.
const UNSIGNED_XDR = "UNSIGNED".padEnd(64, "A");
const SIGNED_XDR = "SIGNED".padEnd(64, "A");

const SOURCE_ACCOUNT = { accountId: () => FROM, sequenceNumber: () => "5" };
const NATIVE_ASSET = { code: "XLM" };

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

type Builder = {
  addOperation: jest.Mock;
  addMemo: jest.Mock;
  setTimeout: jest.Mock;
  build: jest.Mock;
};
type BuiltTransaction = {
  xdr: string;
  passphrase: string;
  sign: jest.Mock;
  toXDR: () => string;
};

function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

function submissionRejection(result_codes: {
  transaction?: string;
  operations?: string[];
}) {
  return {
    message: "Request failed with status code 400",
    response: { status: 400, data: { extras: { result_codes } } },
  };
}

/** The Transaction instances the hook constructed, in order. */
function constructedTransactions(): BuiltTransaction[] {
  return MockTransaction.mock.results.map((r) => r.value as BuiltTransaction);
}

describe("useStellarPayment (default template)", () => {
  let mockLoadAccount: jest.Mock<AsyncFn>;
  let mockSubmitTransaction: jest.Mock<AsyncFn>;
  let builder: Builder;
  let keypair: { publicKey: jest.Mock };
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockLoadAccount = jest.fn<AsyncFn>().mockResolvedValue(SOURCE_ACCOUNT);
    mockSubmitTransaction = jest
      .fn<AsyncFn>()
      .mockResolvedValue({ hash: "tx_hash_123", successful: true });
    MockServer.mockImplementation(() => ({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));

    builder = {
      addOperation: jest.fn().mockReturnThis(),
      addMemo: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({ toXDR: () => UNSIGNED_XDR })),
    };
    MockTransactionBuilder.mockImplementation(() => builder);

    // A parsed transaction whose XDR changes once signed, so the tests can
    // tell whether the signed or the unsigned envelope reached submission.
    MockTransaction.mockImplementation((...args: unknown[]) => {
      const [xdr, passphrase] = args as [string, string];
      let signed = false;
      return {
        xdr,
        passphrase,
        sign: jest.fn(() => {
          signed = true;
        }),
        toXDR: () => (signed ? SIGNED_XDR : xdr),
      };
    });

    keypair = { publicKey: jest.fn(() => FROM) };
    mockFromSecret.mockReturnValue(keypair);

    MockAsset.native.mockReturnValue(NATIVE_ASSET);
    MockAsset.mockImplementation((...args: unknown[]) => {
      const [code, issuer] = args as [string, string];
      return { code, issuer };
    });
    mockPayment.mockImplementation((opts: unknown) => ({
      type: "payment",
      opts,
    }));
    mockMemoText.mockImplementation((text: unknown) => ({
      type: "text",
      value: text,
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns the payment API and connects to the default testnet Horizon", () => {
    const { result } = renderHook(() => useStellarPayment());

    expect(typeof result.current.buildPaymentXDR).toBe("function");
    expect(typeof result.current.submitSignedXDR).toBe("function");
    expect(typeof result.current.signAndSubmitWithSecret).toBe("function");
    expect(MockServer).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org",
    );
  });

  describe("buildPaymentXDR", () => {
    it("builds a native XLM payment against the loaded source account", async () => {
      const { result } = renderHook(() => useStellarPayment());

      const xdr = await result.current.buildPaymentXDR({
        from: FROM,
        to: TO,
        amount: "10.5",
      });

      expect(xdr).toBe(UNSIGNED_XDR);
      expect(mockLoadAccount).toHaveBeenCalledWith(FROM);
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: TESTNET,
      });
      expect(mockPayment).toHaveBeenCalledWith({
        destination: TO,
        asset: NATIVE_ASSET,
        amount: "10.5",
      });
      expect(builder.addOperation).toHaveBeenCalledWith(
        mockPayment.mock.results[0].value,
      );
      expect(builder.addMemo).not.toHaveBeenCalled();
      expect(builder.setTimeout).toHaveBeenCalledWith(30);
    });

    it("builds an issued-asset payment with a text memo on the public network", async () => {
      const { result } = renderHook(() =>
        useStellarPayment({ network: "PUBLIC" }),
      );

      await result.current.buildPaymentXDR({
        from: FROM,
        to: TO,
        amount: "25",
        asset: { code: "EURC", issuer: EURC_ISSUER },
        memo: "Invoice 42",
      });

      expect(MockAsset).toHaveBeenCalledWith("EURC", EURC_ISSUER);
      expect(MockAsset.native).not.toHaveBeenCalled();
      expect(mockPayment).toHaveBeenCalledWith({
        destination: TO,
        asset: { code: "EURC", issuer: EURC_ISSUER },
        amount: "25",
      });
      expect(mockMemoText).toHaveBeenCalledWith("Invoice 42");
      expect(builder.addMemo).toHaveBeenCalledWith({
        type: "text",
        value: "Invoice 42",
      });
      expect(MockTransactionBuilder).toHaveBeenCalledWith(SOURCE_ACCOUNT, {
        fee: "100",
        networkPassphrase: PUBLIC,
      });
    });

    it("uses a caller-supplied Horizon URL", () => {
      renderHook(() =>
        useStellarPayment({ horizonUrl: "https://horizon.example.org" }),
      );

      expect(MockServer).toHaveBeenCalledWith("https://horizon.example.org");
    });

    it.each([
      [{ from: "not-a-key" }, "Invalid sender address format"],
      [{ to: "GSHORT" }, "Invalid recipient address format"],
      [{ amount: "0" }, "Invalid amount"],
      [{ amount: "abc" }, "Invalid amount"],
      [{ to: FROM }, "Sender and recipient cannot be the same address"],
      [
        { asset: { code: "TOO-LONG-CODE!", issuer: EURC_ISSUER } },
        "Invalid asset code",
      ],
      [{ asset: { code: "EURC", issuer: "GBAD" } }, "Invalid asset issuer"],
    ])(
      "rejects invalid params %j before contacting Horizon",
      async (override, message) => {
        const { result } = renderHook(() => useStellarPayment());

        await expect(
          result.current.buildPaymentXDR({
            from: FROM,
            to: TO,
            amount: "10",
            ...override,
          }),
        ).rejects.toThrow(message);
        expect(mockLoadAccount).not.toHaveBeenCalled();
      },
    );

    it("rejects a memo longer than 28 characters", async () => {
      const { result } = renderHook(() => useStellarPayment());

      await expect(
        result.current.buildPaymentXDR({
          from: FROM,
          to: TO,
          amount: "10",
          memo: "x".repeat(29),
        }),
      ).rejects.toThrow("Memo text cannot exceed 28 characters");
      expect(builder.build).not.toHaveBeenCalled();
    });

    it("maps a 404 on the source account to a funding hint", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404, "Not Found"));
      const { result } = renderHook(() => useStellarPayment());

      await expect(
        result.current.buildPaymentXDR({ from: FROM, to: TO, amount: "10" }),
      ).rejects.toThrow(`Account ${FROM} not found. Account may need funding.`);
    });

    it("maps a 5xx from Horizon to a server error", async () => {
      mockLoadAccount.mockRejectedValue(
        horizonError(503, "Service Unavailable"),
      );
      const { result } = renderHook(() => useStellarPayment());

      await expect(
        result.current.buildPaymentXDR({ from: FROM, to: TO, amount: "10" }),
      ).rejects.toThrow("Horizon server error: Service Unavailable");
    });
  });

  describe("submitSignedXDR", () => {
    it("parses the signed XDR for the network and submits it", async () => {
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.submitSignedXDR(SIGNED_XDR);

      expect(MockTransaction).toHaveBeenCalledWith(SIGNED_XDR, TESTNET);
      expect(mockSubmitTransaction).toHaveBeenCalledWith(
        constructedTransactions()[0],
      );
      expect(payment).toEqual({
        success: true,
        txHash: "tx_hash_123",
        raw: { hash: "tx_hash_123", successful: true },
      });
    });

    it("returns a decoded failure with raw result codes when Horizon rejects", async () => {
      const codes = {
        transaction: "tx_failed",
        operations: ["op_underfunded"],
      };
      mockSubmitTransaction.mockRejectedValue(submissionRejection(codes));
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.submitSignedXDR(SIGNED_XDR);

      expect(payment.success).toBe(false);
      expect(payment.txHash).toBeUndefined();
      expect(payment.error).toBe(
        "Source account does not have enough balance to complete this operation.",
      );
      expect(payment.resultCodes).toEqual(codes);
      expect(payment.raw).toEqual({ extras: { result_codes: codes } });
    });

    it("reports a Horizon 5xx during submission", async () => {
      mockSubmitTransaction.mockRejectedValue(horizonError(502));
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.submitSignedXDR(SIGNED_XDR);

      expect(payment).toMatchObject({
        success: false,
        error: "Horizon server error during submission",
      });
    });

    it("rejects a corrupted XDR without reaching the network", async () => {
      const { result } = renderHook(() => useStellarPayment());

      await expect(
        result.current.submitSignedXDR("not base64!"),
      ).rejects.toThrow("Invalid signed transaction XDR");
      expect(MockTransaction).not.toHaveBeenCalled();
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  describe("signAndSubmitWithSecret", () => {
    it("builds, signs with the sender's keypair and submits the signed envelope", async () => {
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.signAndSubmitWithSecret({
        from: FROM,
        to: TO,
        amount: "10.5",
        memo: "Test payment",
        secret: SECRET,
      });

      expect(mockFromSecret).toHaveBeenCalledWith(SECRET);
      expect(mockLoadAccount).toHaveBeenCalledWith(FROM);

      // First the unsigned build is parsed and signed, then the signed XDR is
      // re-parsed by submitSignedXDR and handed to Horizon.
      const [unsigned, submitted] = constructedTransactions();
      expect(MockTransaction).toHaveBeenNthCalledWith(1, UNSIGNED_XDR, TESTNET);
      expect(unsigned.sign).toHaveBeenCalledWith(keypair);
      expect(MockTransaction).toHaveBeenNthCalledWith(2, SIGNED_XDR, TESTNET);
      expect(mockSubmitTransaction).toHaveBeenCalledWith(submitted);

      expect(payment).toMatchObject({ success: true, txHash: "tx_hash_123" });
    });

    it("refuses a secret that does not belong to the sender", async () => {
      keypair.publicKey.mockReturnValue(TO);
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.signAndSubmitWithSecret({
        from: FROM,
        to: TO,
        amount: "10",
        secret: SECRET,
      });

      expect(payment).toEqual({
        success: false,
        error: "Secret key does not match sender address",
      });
      expect(mockLoadAccount).not.toHaveBeenCalled();
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("refuses a malformed secret without touching the SDK", async () => {
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.signAndSubmitWithSecret({
        from: FROM,
        to: TO,
        amount: "10",
        secret: "SHORT",
      });

      expect(payment).toEqual({
        success: false,
        error: "Invalid secret key format",
      });
      expect(mockFromSecret).not.toHaveBeenCalled();
    });

    it("returns the build error instead of throwing", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404));
      const { result } = renderHook(() => useStellarPayment());

      const payment = await result.current.signAndSubmitWithSecret({
        from: FROM,
        to: TO,
        amount: "10",
        secret: SECRET,
      });

      expect(payment).toEqual({
        success: false,
        error: `Account ${FROM} not found. Account may need funding.`,
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  it("should build fee-bump payment transaction given a sponsor", async () => {
    mockUseStellarPayment.mockReturnValue({
      ...mockUseStellarPayment(),
      buildFeeBumpPaymentXDR: jest.fn().mockResolvedValue("mock_feebump_xdr"),
    });

    const { result } = renderHook(() => mockUseStellarPayment());
    const feeBumpParams = {
      ...validPaymentParams,
      sponsor: "GSPONSOR12345678901234567890123456789012345678901234567890",
    };

    let xdr: string;
    await act(async () => {
      xdr = await result.current.buildFeeBumpPaymentXDR(feeBumpParams);
    });

    expect(xdr!).toBe("mock_feebump_xdr");
  });
});

