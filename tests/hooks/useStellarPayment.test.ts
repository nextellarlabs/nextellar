/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Setup TextEncoder/TextDecoder for this test file
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock the Stellar SDK module entirely since it's not a dependency of the main CLI
jest.mock('@stellar/stellar-sdk', () => ({
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
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Asset: {
    native: jest.fn(),
  },
  Memo: {
    text: jest.fn(),
  },
  BASE_FEE: '100',
  Transaction: jest.fn(),
}));

// Import from template directory since hooks should only exist there
const { useStellarPayment } = require('../../src/templates/ts-template/src/hooks/useStellarPayment');

type PaymentParams = {
  from: string;
  to: string;
  amount: string;
  asset?: 'XLM' | { code: string; issuer: string };
  memo?: string;
};

type PaymentResult = { 
  success: boolean; 
  txHash?: string; 
  raw?: any; 
  error?: any 
};

describe('useStellarPayment (Template Hook)', () => {
  let mockServer: any;
  let mockLoadAccount: jest.Mock;
  let mockSubmitTransaction: jest.Mock;
  let mockTransactionBuilder: any;
  let mockTransaction: any;
  let mockKeypair: any;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock console.error to avoid test noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Mock account data
    const mockAccount = {
      accountId: () => 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
      sequenceNumber: () => '123456789',
      incrementSequenceNumber: jest.fn(),
    };

    // Mock server methods
    mockLoadAccount = jest.fn().mockResolvedValue(mockAccount);
    mockSubmitTransaction = jest.fn().mockResolvedValue({
      hash: 'tx_hash_123',
      successful: true,
    });

    mockServer = {
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    };

    // Mock transaction and builder
    mockTransaction = {
      toXDR: jest.fn().mockReturnValue('mock_unsigned_xdr'),
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
      publicKey: jest.fn().mockReturnValue('GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO'),
    };

    // Setup mocked SDK components
    require('@stellar/stellar-sdk').Horizon.Server.mockImplementation(() => mockServer);
    require('@stellar/stellar-sdk').TransactionBuilder.mockImplementation(() => mockTransactionBuilder);
    require('@stellar/stellar-sdk').Transaction.mockImplementation((xdr) => ({
      ...mockTransaction,
      toXDR: () => xdr,
    }));
    require('@stellar/stellar-sdk').Keypair.fromSecret.mockReturnValue(mockKeypair);
    require('@stellar/stellar-sdk').Asset.native.mockReturnValue({ isNative: () => true });
    require('@stellar/stellar-sdk').Operation.payment.mockReturnValue({ type: 'payment' });
    require('@stellar/stellar-sdk').Memo.text.mockImplementation((text) => ({ type: 'text', value: text }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validPaymentParams: PaymentParams = {
    from: 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
    to: 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT',
    amount: '10.5',
    asset: 'XLM',
    memo: 'Test payment',
  };

  it('should return payment functions', () => {
    const { result } = renderHook(() => useStellarPayment());

    expect(typeof result.current.buildPaymentXDR).toBe('function');
    expect(typeof result.current.submitSignedXDR).toBe('function');
    expect(typeof result.current.signAndSubmitWithSecret).toBe('function');
  });

  it('should build unsigned XDR successfully', async () => {
    const { result } = renderHook(() => useStellarPayment());

    await act(async () => {
      const xdr = await result.current.buildPaymentXDR(validPaymentParams);
      expect(xdr).toBe('mock_unsigned_xdr');
    });

    expect(mockLoadAccount).toHaveBeenCalledWith(validPaymentParams.from);
    expect(require('@stellar/stellar-sdk').TransactionBuilder).toHaveBeenCalled();
    expect(require('@stellar/stellar-sdk').Operation.payment).toHaveBeenCalledWith({
      destination: validPaymentParams.to,
      asset: expect.any(Object),
      amount: validPaymentParams.amount,
    });
  });

  it('should validate payment parameters', async () => {
    const { result } = renderHook(() => useStellarPayment());

    // Test invalid sender address
    await act(async () => {
      try {
        await result.current.buildPaymentXDR({
          ...validPaymentParams,
          from: 'invalid_address',
        });
        fail('Expected validation error');
      } catch (error: any) {
        expect(error.message).toContain('Invalid sender address format');
      }
    });
  });

  it('should submit signed XDR successfully', async () => {
    const { result } = renderHook(() => useStellarPayment());
    const signedXdr = 'signed_xdr_string';

    let paymentResult: PaymentResult;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(signedXdr);
    });

    expect(paymentResult!.success).toBe(true);
    expect(paymentResult!.txHash).toBe('tx_hash_123');
    expect(mockSubmitTransaction).toHaveBeenCalled();
  });

  it('should sign and submit successfully in development mode', async () => {
    const { result } = renderHook(() => useStellarPayment());
    const paramsWithSecret = {
      ...validPaymentParams,
      secret: 'SCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
    };

    let paymentResult: PaymentResult;
    await act(async () => {
      paymentResult = await result.current.signAndSubmitWithSecret(paramsWithSecret);
    });

    expect(paymentResult!.success).toBe(true);
    expect(paymentResult!.txHash).toBe('tx_hash_123');
    expect(require('@stellar/stellar-sdk').Keypair.fromSecret).toHaveBeenCalledWith(paramsWithSecret.secret);
    expect(mockTransaction.sign).toHaveBeenCalledWith(mockKeypair);
  });
});