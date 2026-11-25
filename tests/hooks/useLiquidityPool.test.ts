/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";

const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();

const MockServer = jest.fn().mockImplementation(() => ({
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
}));

const mockDeposit = jest.fn().mockReturnValue({ type: "liquidityPoolDeposit" });
const mockWithdraw = jest.fn().mockReturnValue({ type: "liquidityPoolWithdraw" });
const mockChangeTrust = jest.fn().mockReturnValue({ type: "changeTrust" });

const mockAddOperation = jest.fn().mockReturnThis();
const mockSetTimeout = jest.fn().mockReturnThis();
const mockBuild = jest.fn().mockReturnValue({
  toXDR: () => "mock-unsigned-xdr",
});

const MockTransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: mockAddOperation,
  setTimeout: mockSetTimeout,
  build: mockBuild,
}));

const MockLiquidityPoolAsset = jest.fn().mockImplementation((a, b, fee) => ({
  a,
  b,
  fee,
}));

const MockAsset = {
  native: jest.fn().mockReturnValue({ code: "XLM" }),
};

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  TransactionBuilder: MockTransactionBuilder,
  Operation: {
    liquidityPoolDeposit: mockDeposit,
    liquidityPoolWithdraw: mockWithdraw,
    changeTrust: mockChangeTrust,
  },
  LiquidityPoolAsset: MockLiquidityPoolAsset,
  Asset: MockAsset,
  BASE_FEE: "100",
  Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
  Transaction: jest.fn().mockImplementation(() => ({
    toXDR: () => "mock-tx-xdr",
    sign: jest.fn(),
  })),
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () => "GAALICE",
    }),
  },
}));

const { useLiquidityPool } = await import(
  "../../src/templates/default/src/hooks/useLiquidityPool.js"
);

describe("useLiquidityPool hook (#1439)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("happy path: builds deposit XDR with existing trustline", async () => {
    const poolId = "67260c4c1807b262ff851b0a3fe141194936bb0215b2f774dcda5671a463eeee";
    mockLoadAccount.mockResolvedValueOnce({
      balances: [
        {
          asset_type: "liquidity_pool_shares",
          liquidity_pool_id: poolId,
        },
      ],
    });

    const { result } = renderHook(() => useLiquidityPool());

    const xdr = await result.current.buildDepositXDR({
      from: "GAALICE",
      liquidityPoolId: poolId,
      maxAmountA: "100.0000000",
      maxAmountB: "50.0000000",
      minPrice: "0.45",
      maxPrice: "0.55",
    });

    expect(xdr).toBe("mock-unsigned-xdr");
    expect(mockDeposit).toHaveBeenCalledWith({
      liquidityPoolId: poolId,
      maxAmountA: "100.0000000",
      maxAmountB: "50.0000000",
      minPrice: "0.45",
      maxPrice: "0.55",
    });
    // Should NOT have called changeTrust since trustline already exists
    expect(mockChangeTrust).not.toHaveBeenCalled();
  });

  it("happy path: establishes pool-share trustline when missing", async () => {
    const poolId = "67260c4c1807b262ff851b0a3fe141194936bb0215b2f774dcda5671a463eeee";
    mockLoadAccount.mockResolvedValueOnce({
      balances: [
        { asset_type: "native", balance: "100.0000000" },
      ],
    });

    const { result } = renderHook(() => useLiquidityPool());

    const assetA = { code: "XLM" } as any;
    const assetB = { code: "USDC" } as any;

    const xdr = await result.current.buildDepositXDR({
      from: "GAALICE",
      liquidityPoolId: poolId,
      maxAmountA: "100.0000000",
      maxAmountB: "50.0000000",
      minPrice: "0.45",
      maxPrice: "0.55",
      assetA,
      assetB,
    });

    expect(xdr).toBe("mock-unsigned-xdr");
    expect(mockChangeTrust).toHaveBeenCalled();
    expect(mockDeposit).toHaveBeenCalled();
  });

  it("happy path: builds withdraw XDR with minimum receive bounds", async () => {
    const poolId = "67260c4c1807b262ff851b0a3fe141194936bb0215b2f774dcda5671a463eeee";
    mockLoadAccount.mockResolvedValueOnce({
      balances: [{ asset_type: "liquidity_pool_shares", liquidity_pool_id: poolId }],
    });

    const { result } = renderHook(() => useLiquidityPool());

    const xdr = await result.current.buildWithdrawXDR({
      from: "GAALICE",
      liquidityPoolId: poolId,
      amount: "10.0000000",
      minAmountA: "9.5000000",
      minAmountB: "4.8000000",
    });

    expect(xdr).toBe("mock-unsigned-xdr");
    expect(mockWithdraw).toHaveBeenCalledWith({
      liquidityPoolId: poolId,
      amount: "10.0000000",
      minAmountA: "9.5000000",
      minAmountB: "4.8000000",
    });
  });

  it("failure mode 1: rejects when minPrice is greater than maxPrice", async () => {
    const poolId = "67260c4c1807b262ff851b0a3fe141194936bb0215b2f774dcda5671a463eeee";
    const { result } = renderHook(() => useLiquidityPool());

    await expect(
      result.current.buildDepositXDR({
        from: "GAALICE",
        liquidityPoolId: poolId,
        maxAmountA: "100",
        maxAmountB: "100",
        minPrice: "2.0",
        maxPrice: "1.0",
      }),
    ).rejects.toThrow(/minPrice cannot be greater than maxPrice/);
  });

  it("failure mode 2: missing pool-share trustline without assets throws informative error", async () => {
    const poolId = "67260c4c1807b262ff851b0a3fe141194936bb0215b2f774dcda5671a463eeee";
    mockLoadAccount.mockResolvedValueOnce({
      balances: [{ asset_type: "native", balance: "100.0000000" }],
    });

    const { result } = renderHook(() => useLiquidityPool());

    await expect(
      result.current.buildDepositXDR({
        from: "GAALICE",
        liquidityPoolId: poolId,
        maxAmountA: "100",
        maxAmountB: "100",
        minPrice: "0.9",
        maxPrice: "1.1",
      }),
    ).rejects.toThrow(/missing pool-share trustline/);
  });
});
