/**
 * @jest-environment jsdom
 *
 * Regression coverage for #847: useTrustlines must surface both Stellar
 * authorization flags (full `is_authorized` and partial
 * `is_authorized_to_maintain_liabilities`), and limit "0" must be treated
 * as trustline removal when building a change-trust XDR.
 *
 * Unlike useTrustlines.test.ts (which mocks the hook itself), this file
 * imports and exercises the REAL hook, mocking only its
 * @stellar/stellar-sdk dependency.
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const mockAccountsCall = jest.fn();
const mockLoadAccount = jest.fn();
const mockAddOperation = jest.fn().mockReturnThis();
const mockSetTimeout = jest.fn().mockReturnThis();
const mockBuild = jest.fn().mockReturnValue({ toXDR: () => "mock_xdr" });
const mockChangeTrust = jest.fn((args: unknown) => ({
  type: "changeTrust",
  args,
}));

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      accounts: () => ({ accountId: () => ({ call: mockAccountsCall }) }),
      loadAccount: mockLoadAccount,
    })),
  },
  Keypair: { fromSecret: jest.fn() },
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: mockAddOperation,
    setTimeout: mockSetTimeout,
    build: mockBuild,
  })),
  Operation: { changeTrust: mockChangeTrust },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  Asset: jest
    .fn()
    .mockImplementation((code: string, issuer: string) => ({ code, issuer })),
  BASE_FEE: "100",
  Transaction: jest.fn(),
}));

const { useTrustlines } =
  await import("../../src/templates/default/src/hooks/useTrustlines.js");

const VALID_PUBLIC_KEY =
  "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const VALID_ISSUER = "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

function balanceLine(overrides: Record<string, unknown>) {
  return {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: VALID_ISSUER,
    balance: "100.0000000",
    limit: "1000.0000000",
    is_authorized: true,
    is_authorized_to_maintain_liabilities: true,
    is_clawback_enabled: false,
    ...overrides,
  };
}

describe("useTrustlines — authorization flags (#847)", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it("surfaces full authorization (authorized: true, authorizedToMaintainLiabilities: true)", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        balanceLine({
          is_authorized: true,
          is_authorized_to_maintain_liabilities: true,
        }),
      ],
    });

    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));
    await act(async () => {});

    expect(result.current.trustlines[0].authorized).toBe(true);
    expect(result.current.trustlines[0].authorizedToMaintainLiabilities).toBe(
      true,
    );
  });

  it("distinguishes partial authorization (revoked but can maintain liabilities) from full authorization", async () => {
    // The AUTH_REVOCABLE "partial auth" state: issuer revoked full
    // authorization but still permits holding/settling the existing balance.
    mockAccountsCall.mockResolvedValue({
      balances: [
        balanceLine({
          is_authorized: false,
          is_authorized_to_maintain_liabilities: true,
        }),
      ],
    });

    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));
    await act(async () => {});

    expect(result.current.trustlines[0].authorized).toBe(false);
    expect(result.current.trustlines[0].authorizedToMaintainLiabilities).toBe(
      true,
    );
  });

  it("surfaces fully unauthorized (both flags false)", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        balanceLine({
          is_authorized: false,
          is_authorized_to_maintain_liabilities: false,
        }),
      ],
    });

    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));
    await act(async () => {});

    expect(result.current.trustlines[0].authorized).toBe(false);
    expect(result.current.trustlines[0].authorizedToMaintainLiabilities).toBe(
      false,
    );
  });
});

describe("useTrustlines — limit-0 removal (#847)", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLoadAccount.mockResolvedValue({
      accountId: () => VALID_PUBLIC_KEY,
      sequenceNumber: () => "1",
    });
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('passes limit "0" through to Operation.changeTrust to remove the trustline', async () => {
    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));

    await act(async () => {
      await result.current.buildChangeTrustXDR({
        code: "USDC",
        issuer: VALID_ISSUER,
        limit: "0",
      });
    });

    expect(mockChangeTrust).toHaveBeenCalledWith(
      expect.objectContaining({ limit: "0" }),
    );
  });

  it('omits limit entirely (max trust) when no limit is given, distinct from limit "0"', async () => {
    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));

    await act(async () => {
      await result.current.buildChangeTrustXDR({
        code: "USDC",
        issuer: VALID_ISSUER,
      });
    });

    const callArgs = mockChangeTrust.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs).not.toHaveProperty("limit");
  });

  it('accepts limit "0" as valid input rather than rejecting it as falsy', async () => {
    const { result } = renderHook(() => useTrustlines(VALID_PUBLIC_KEY));

    await expect(
      act(async () => {
        await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: VALID_ISSUER,
          limit: "0",
        });
      }),
    ).resolves.not.toThrow();
  });
});
