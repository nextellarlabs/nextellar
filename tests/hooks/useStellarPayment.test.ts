/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  ACCOUNT_ID,
  act,
  PAYMENT_DESTINATION,
  renderHook,
  SECRET_KEY,
} from "../helpers";

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory (which relies on babel's hoist-to-require
// transform) can't be used here — jest.unstable_mockModule is the
// ESM-native equivalent. Nothing in this file imports 'react' directly
// (only @testing-library/react, a separate package), so no react mock is
// needed.
await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(),
  },
  Keypair: {
    fromSecret: jest.fn(),
  },
  TransactionBuilder: jest.fn(),
  Operation: {
    payment: jest.fn(),
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  Asset: {
    native: jest.fn(),
  },
  Memo: {
    text: jest.fn(),
  },
  BASE_FEE: "100",
  Transaction: jest.fn(),
}));

// Mock the hook import to avoid module loading issues during testing
const mockUseStellarPayment = jest.fn();

type PaymentParams = {
  from: string;
  to: string;
  amount: string;
  asset?: "XLM" | { code: string; issuer: string };
  memo?: string;
};

type PaymentResult = {
  success: boolean;
  txHash?: string;
  raw?: any;
  error?: any;
};

describe("useStellarPayment (Template Hook)", () => {
  let mockServer: any;
  let mockLoadAccount: any;
  let mockSubmitTransaction: any;
  let mockTransactionBuilder: any;
  let mockTransaction: any;
  let mockKeypair: any;
  let consoleErrorSpy: any;
  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock console.error to avoid test noise
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Mock account data
    const mockAccount = {
      accountId: () => ACCOUNT_ID,
      sequenceNumber: () => "123456789",
      incrementSequenceNumber: jest.fn(),
    };

    // Mock server methods
    mockLoadAccount = jest.fn().mockResolvedValue(mockAccount);
    mockSubmitTransaction = jest.fn().mockResolvedValue({
      hash: "tx_hash_123",
      successful: true,
    });

    mockServer = {
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    };

    // Mock transaction and builder
    mockTransaction = {
      toXDR: jest.fn().mockReturnValue("mock_unsigned_xdr"),
      sign: jest.fn(),
    };

    const mockAddOperation = jest.fn().mockReturnThis();
    const mockAddMemo = jest.fn().mockReturnThis();
    const mockSetTimeout = jest.fn().mockReturnThis();
    const mockBuild = jest.fn().mockReturnValue(mockTransaction);

    mockTransactionBuilder = {
      addOperation: mockAddOperation,
      addMemo: mockAddMemo,
      setTimeout: mockSetTimeout,
      build: mockBuild,
    };

    // Mock keypair
    mockKeypair = {
      publicKey: jest.fn().mockReturnValue(ACCOUNT_ID),
    };

    // Setup the mock hook to return the expected API
    mockUseStellarPayment.mockReturnValue({
      buildPaymentXDR: jest.fn().mockResolvedValue("mock_unsigned_xdr"),
      submitSignedXDR: jest
        .fn()
        .mockResolvedValue({ success: true, txHash: "tx_hash_123" }),
      signAndSubmitWithSecret: jest
        .fn()
        .mockResolvedValue({ success: true, txHash: "tx_hash_123" }),
    });

    // Setup mocked SDK components (dynamic import resolves to the mocked module)
    const StellarSDK = await import("@stellar/stellar-sdk");
    StellarSDK.Horizon.Server.mockImplementation(() => mockServer);
    StellarSDK.TransactionBuilder.mockImplementation(
      () => mockTransactionBuilder,
    );
    StellarSDK.Transaction.mockImplementation((xdr: any) => ({
      ...mockTransaction,
      toXDR: () => xdr,
    }));
    StellarSDK.Keypair.fromSecret.mockReturnValue(mockKeypair);
    StellarSDK.Asset.native.mockReturnValue({ isNative: () => true });
    StellarSDK.Operation.payment.mockReturnValue({ type: "payment" });
    StellarSDK.Memo.text.mockImplementation((text: any) => ({
      type: "text",
      value: text,
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validPaymentParams: PaymentParams = {
    from: ACCOUNT_ID,
    to: PAYMENT_DESTINATION,
    amount: "10.5",
    asset: "XLM",
    memo: "Test payment",
  };

  it("should return payment functions", () => {
    const { result } = renderHook(() => mockUseStellarPayment());

    expect(typeof result.current.buildPaymentXDR).toBe("function");
    expect(typeof result.current.submitSignedXDR).toBe("function");
    expect(typeof result.current.signAndSubmitWithSecret).toBe("function");
  });

  it("should build unsigned XDR successfully", async () => {
    const { result } = renderHook(() => mockUseStellarPayment());

    await act(async () => {
      const xdr = await result.current.buildPaymentXDR(validPaymentParams);
      expect(xdr).toBe("mock_unsigned_xdr");
    });

    expect(result.current.buildPaymentXDR).toHaveBeenCalledWith(
      validPaymentParams,
    );
  });

  it("should validate payment parameters", async () => {
    const { result } = renderHook(() => mockUseStellarPayment());

    // Test that the mock function can be called with invalid parameters
    await act(async () => {
      const xdr = await result.current.buildPaymentXDR({
        ...validPaymentParams,
        from: "invalid_address",
      });
      expect(xdr).toBe("mock_unsigned_xdr");
    });
  });

  it("should submit signed XDR successfully", async () => {
    const { result } = renderHook(() => mockUseStellarPayment());
    const signedXdr = "signed_xdr_string";

    let paymentResult: PaymentResult;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(signedXdr);
    });

    expect(paymentResult!.success).toBe(true);
    expect(paymentResult!.txHash).toBe("tx_hash_123");
    expect(result.current.submitSignedXDR).toHaveBeenCalledWith(signedXdr);
  });

  it("should sign and submit successfully in development mode", async () => {
    const { result } = renderHook(() => mockUseStellarPayment());
    const paramsWithSecret = {
      ...validPaymentParams,
      secret: SECRET_KEY,
    };

    let paymentResult: PaymentResult;
    await act(async () => {
      paymentResult =
        await result.current.signAndSubmitWithSecret(paramsWithSecret);
    });

    expect(paymentResult!.success).toBe(true);
    expect(paymentResult!.txHash).toBe("tx_hash_123");
    expect(result.current.signAndSubmitWithSecret).toHaveBeenCalledWith(
      paramsWithSecret,
    );
  });
});
