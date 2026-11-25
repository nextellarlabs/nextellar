/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";

const {
  mockLoadAccount,
  mockSubmitTransaction,
  mockStrictSendPaths,
  mockStrictReceivePaths,
  mockStrictSendPathsCall,
  mockStrictReceivePathsCall,
  resetHorizonMocks,
  createHorizonMock,
} = await import("../../src/mocks/stellar-horizon-mock.js");

await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return createHorizonMock(actual);
});

const { Keypair } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");

const { usePathPayment } =
  await import("../../src/templates/default/src/hooks/usePathPayment.js");

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();
const USDC = { code: "USDC", issuer: Keypair.random().publicKey() };

describe("usePathPayment (default template) (#1440)", () => {
  beforeEach(() => {
    resetHorizonMocks();
  });

  it("happy path: finds paths and selects best quote", async () => {
    mockStrictSendPathsCall.mockResolvedValueOnce({
      records: [
        {
          source_asset_type: "native",
          source_amount: "10.0000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          destination_asset_issuer: USDC.issuer,
          destination_amount: "5.0000000",
          path: [],
        },
        {
          source_asset_type: "native",
          source_amount: "10.0000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          destination_asset_issuer: USDC.issuer,
          destination_amount: "5.5000000",
          path: [],
        },
      ],
    });

    const { result } = renderHook(() => usePathPayment());

    const paths = await result.current.findPaths({
      mode: "strict-send",
      sourceAsset: "XLM",
      destinationAsset: USDC,
      amount: "10.0000000",
    });

    expect(paths).toHaveLength(2);

    mockStrictSendPathsCall.mockResolvedValueOnce({
      records: [
        {
          source_asset_type: "native",
          source_amount: "10.0000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          destination_asset_issuer: USDC.issuer,
          destination_amount: "5.5000000",
          path: [],
        },
      ],
    });

    const best = await result.current.findBestPath({
      mode: "strict-send",
      sourceAsset: "XLM",
      destinationAsset: USDC,
      amount: "10.0000000",
    });

    expect(best?.destinationAmount).toBe("5.5000000");
  });

  it("failure mode 1: rejects invalid amount", async () => {
    const { result } = renderHook(() => usePathPayment());

    await expect(
      result.current.findPaths({
        mode: "strict-send",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "-10",
      }),
    ).rejects.toThrow(/Invalid amount/);
  });

  it("failure mode 2: handles horizon error gracefully during path finding", async () => {
    mockStrictSendPathsCall.mockRejectedValueOnce({
      response: { status: 500 },
      message: "Server internal error",
    });

    const { result } = renderHook(() => usePathPayment());

    await expect(
      result.current.findPaths({
        mode: "strict-send",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "10.0000000",
      }),
    ).rejects.toThrow(/Horizon server error/);
  });
});
