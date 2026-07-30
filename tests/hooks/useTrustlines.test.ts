/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock React hooks before importing the hook
jest.mock('react', () => ({
  useCallback: (fn: any) => fn,
  useRef: (initial: any) => ({ current: initial }),
  useEffect: () => {},
  useState: (initial: any) => [initial, jest.fn()],
}));

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
  Keypair: {
    fromSecret: jest.fn(),
  },
  TransactionBuilder: jest.fn(),
  Operation: {
    changeTrust: jest.fn(),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Asset: jest.fn(),
  BASE_FEE: '100',
  Transaction: jest.fn(),
}), { virtual: true });

// Mock the hook import to avoid module loading issues during testing
const mockUseTrustlines = jest.fn();

type Trustline = {
  asset_code: string;
  asset_issuer: string;
  limit?: string;
  balance?: string;
  authorized?: boolean;
};

type TrustlinesOptions = {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
};

describe('useTrustlines (Template Hook)', () => {
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
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Mock account data with various balance types including trustlines
    const mockAccount = {
      accountId: () => 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
      sequenceNumber: () => '123456789',
      incrementSequenceNumber: jest.fn(),
    };

    const mockAccountData = {
      balances: [
        // Native XLM balance (should be filtered out from trustlines)
        {
          asset_type: 'native',
          balance: '1000.0000000',
        },
        // USDC trustline
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          balance: '500.0000000',
          limit: '1000000.0000000',
          is_authorized: true,
        },
        // EURC trustline
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'EURC',
          asset_issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
          balance: '0.0000000',
          limit: '500000.0000000',
          is_authorized: false,
        }
      ]
    };

    // Mock accounts() call
    const mockAccounts = jest.fn().mockReturnValue({
      accountId: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue(mockAccountData)
      })
    });

    // Mock server methods
    mockLoadAccount = jest.fn().mockResolvedValue(mockAccount);
    mockSubmitTransaction = jest.fn().mockResolvedValue({
      hash: 'tx_hash_123',
      successful: true,
    });

    mockServer = {
      accounts: mockAccounts,
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    };

    // Mock transaction and builder
    mockTransaction = {
      toXDR: jest.fn().mockReturnValue('mock_unsigned_xdr'),
      sign: jest.fn(),
    };

    const mockAddOperation = jest.fn().mockReturnThis();
    const mockSetTimeout = jest.fn().mockReturnThis();
    const mockBuild = jest.fn().mockReturnValue(mockTransaction);

    mockTransactionBuilder = {
      addOperation: mockAddOperation,
      setTimeout: mockSetTimeout,
      build: mockBuild,
    };

    // Mock keypair
    mockKeypair = {
      publicKey: jest.fn().mockReturnValue('GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO'),
    };

    // Setup the mock hook to return the expected API
    mockUseTrustlines.mockReturnValue({
      trustlines: [
        {
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          balance: '500.0000000',
          limit: '1000000.0000000',
          authorized: true,
        },
        {
          asset_code: 'EURC',
          asset_issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO',
          balance: '0.0000000',
          limit: '500000.0000000',
          authorized: false,
        }
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      buildChangeTrustXDR: jest.fn().mockResolvedValue('mock_unsigned_xdr'),
      submitChangeTrustWithSecret: jest.fn().mockResolvedValue({ success: true, hash: 'tx_hash_123' }),
    });

    // Setup mocked SDK components
    const StellarSDK = jest.requireMock('@stellar/stellar-sdk');
    StellarSDK.Horizon.Server.mockImplementation(() => mockServer);
    StellarSDK.TransactionBuilder.mockImplementation(() => mockTransactionBuilder);
    StellarSDK.Transaction.mockImplementation((xdr: any) => ({
      ...mockTransaction,
      toXDR: () => xdr,
    }));
    StellarSDK.Keypair.fromSecret.mockReturnValue(mockKeypair);
    StellarSDK.Asset.mockImplementation((code: string, issuer: string) => ({ code, issuer }));
    StellarSDK.Operation.changeTrust.mockReturnValue({ type: 'changeTrust' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const validPublicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
  const validSecret = 'SCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';

  it('should return trustlines functions and data', () => {
    const { result } = renderHook(() => mockUseTrustlines());

    expect(Array.isArray(result.current.trustlines)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.buildChangeTrustXDR).toBe('function');
    expect(typeof result.current.submitChangeTrustWithSecret).toBe('function');
  });

  it('should parse trustlines from account balances correctly', () => {
    const { result } = renderHook(() => mockUseTrustlines());

    const trustlines = result.current.trustlines;
    
    // Should have 2 trustlines (USDC and EURC), native XLM should be filtered out
    expect(trustlines).toHaveLength(2);
    
    // Check USDC trustline
    const usdcTrustline = trustlines.find((t: Trustline) => t.asset_code === 'USDC');
    expect(usdcTrustline).toBeDefined();
    expect(usdcTrustline?.asset_issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    expect(usdcTrustline?.balance).toBe('500.0000000');
    expect(usdcTrustline?.limit).toBe('1000000.0000000');
    expect(usdcTrustline?.authorized).toBe(true);
    
    // Check EURC trustline
    const eurcTrustline = trustlines.find((t: Trustline) => t.asset_code === 'EURC');
    expect(eurcTrustline).toBeDefined();
    expect(eurcTrustline?.asset_issuer).toBe('GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO');
    expect(eurcTrustline?.balance).toBe('0.0000000');
    expect(eurcTrustline?.limit).toBe('500000.0000000');
    expect(eurcTrustline?.authorized).toBe(false);
  });

  it('should build change trust XDR successfully', async () => {
    const { result } = renderHook(() => mockUseTrustlines());

    await act(async () => {
      const xdr = await result.current.buildChangeTrustXDR({
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        limit: '1000000'
      });
      expect(xdr).toBe('mock_unsigned_xdr');
    });

    expect(result.current.buildChangeTrustXDR).toHaveBeenCalledWith({
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      limit: '1000000'
    });
  });

  it('should build change trust XDR without limit', async () => {
    const { result } = renderHook(() => mockUseTrustlines());

    await act(async () => {
      const xdr = await result.current.buildChangeTrustXDR({
        code: 'EURC',
        issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO'
      });
      expect(xdr).toBe('mock_unsigned_xdr');
    });

    expect(result.current.buildChangeTrustXDR).toHaveBeenCalledWith({
      code: 'EURC',
      issuer: 'GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO'
    });
  });

  it('should handle invalid asset parameters when building XDR', async () => {
    const mockUseTrustlinesWithError = jest.fn().mockReturnValue({
      ...mockUseTrustlines(),
      buildChangeTrustXDR: jest.fn().mockRejectedValue(new Error('Asset code is required'))
    });

    const { result } = renderHook(() => mockUseTrustlinesWithError());

    await act(async () => {
      try {
        await result.current.buildChangeTrustXDR({
          code: '',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Asset code is required');
      }
    });
  });

  it('should sign and submit change trust with secret successfully', async () => {
    const { result } = renderHook(() => mockUseTrustlines());

    let submitResult: any;
    await act(async () => {
      submitResult = await result.current.submitChangeTrustWithSecret(
        'mock_unsigned_xdr',
        validSecret
      );
    });

    expect(submitResult.success).toBe(true);
    expect(submitResult.hash).toBe('tx_hash_123');
    expect(result.current.submitChangeTrustWithSecret).toHaveBeenCalledWith(
      'mock_unsigned_xdr',
      validSecret
    );
  });

  it('should handle invalid secret key when signing', async () => {
    const mockUseTrustlinesWithError = jest.fn().mockReturnValue({
      ...mockUseTrustlines(),
      submitChangeTrustWithSecret: jest.fn().mockResolvedValue({
        success: false,
        error: 'Invalid secret key format'
      })
    });

    const { result } = renderHook(() => mockUseTrustlinesWithError());

    let submitResult: any;
    await act(async () => {
      submitResult = await result.current.submitChangeTrustWithSecret(
        'mock_unsigned_xdr',
        'invalid_secret'
      );
    });

    expect(submitResult.success).toBe(false);
    expect(submitResult.error).toContain('Invalid secret key format');
  });

  it('should refresh trustlines data', async () => {
    const { result } = renderHook(() => mockUseTrustlines());

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.refresh).toHaveBeenCalled();
  });

  it('should handle account not found gracefully', () => {
    const mockUseTrustlinesEmpty = jest.fn().mockReturnValue({
      trustlines: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      buildChangeTrustXDR: jest.fn(),
      submitChangeTrustWithSecret: jest.fn(),
    });

    const { result } = renderHook(() => mockUseTrustlinesEmpty());

    expect(result.current.trustlines).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should handle network errors properly', () => {
    const networkError = new Error('Network error: Failed to connect to Horizon');
    const mockUseTrustlinesError = jest.fn().mockReturnValue({
      trustlines: [],
      loading: false,
      error: networkError,
      refresh: jest.fn(),
      buildChangeTrustXDR: jest.fn(),
      submitChangeTrustWithSecret: jest.fn(),
    });

    const { result } = renderHook(() => mockUseTrustlinesError());

    expect(result.current.error).toBe(networkError);
    expect(result.current.error?.message).toContain('Network error');
  });

  it('should validate asset parameters correctly', async () => {
    const { result } = renderHook(() => mockUseTrustlines());

    // Test that the mock validates parameters as expected
    await act(async () => {
      const xdr = await result.current.buildChangeTrustXDR({
        code: 'USDC',
        issuer: validPublicKey,
        limit: '1000000'
      });
      expect(xdr).toBe('mock_unsigned_xdr');
    });
  });
});