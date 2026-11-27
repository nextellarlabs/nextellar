/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";

const mockCall = jest.fn<() => Promise<unknown>>();
const mockAccountId = jest.fn(() => ({ call: mockCall }));
const mockAccounts = jest.fn(() => ({ accountId: mockAccountId }));

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: mockAccounts,
    })),
  },
  Networks,
  StrKey,
}));

const { useStellarAccount } =
  await import("../../src/templates/default/src/hooks/useStellarAccount");

const VALID_ACCOUNT = Keypair.random().publicKey();
const COSIGNER = Keypair.random().publicKey();

describe("useStellarAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns idle empty state when publicKey is undefined or blank", async () => {
    const { result } = renderHook(() => useStellarAccount(undefined));
    expect(result.current.account).toBeNull();
    expect(result.current.exists).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockAccounts).not.toHaveBeenCalled();
  });

  it("loads signers, thresholds, flags, and sequence for a funded account", async () => {
    mockCall.mockResolvedValueOnce({
      id: VALID_ACCOUNT,
      account_id: VALID_ACCOUNT,
      sequence: "99001122",
      subentry_count: 2,
      home_domain: "nextellar.dev",
      thresholds: {
        low_threshold: 1,
        med_threshold: 2,
        high_threshold: 3,
      },
      flags: {
        auth_required: true,
        auth_revocable: false,
        auth_immutable: false,
        auth_clawback_enabled: true,
      },
      signers: [
        { key: VALID_ACCOUNT, weight: 2, type: "ed25519_public_key" },
        { key: COSIGNER, weight: 1, type: "ed25519_public_key" },
      ],
    });

    const { result } = renderHook(() => useStellarAccount(VALID_ACCOUNT));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.exists).toBe(true);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.sequence).toBe("99001122");
    expect(result.current.account?.homeDomain).toBe("nextellar.dev");
    expect(result.current.thresholds).toEqual({
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 3,
    });
    expect(result.current.flags).toEqual({
      auth_required: true,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: true,
    });
    expect(result.current.signers).toHaveLength(2);
    expect(result.current.signers[1]).toEqual({
      key: COSIGNER,
      weight: 1,
      type: "ed25519_public_key",
    });
  });

  it("handles unfunded 404 accounts gracefully with exists=false and error=null", async () => {
    mockCall.mockRejectedValueOnce({
      response: { status: 404 },
      message: "Not Found",
    });

    const { result } = renderHook(() => useStellarAccount(VALID_ACCOUNT));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.exists).toBe(false);
    expect(result.current.account).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error for invalid public keys or Horizon 500 failures and recovers on refresh", async () => {
    const { result: invalidRes } = renderHook(() =>
      useStellarAccount("GNOTAVALIDKEY"),
    );
    await waitFor(() => {
      expect(invalidRes.current.error?.message).toMatch(
        /Invalid Stellar public key format/,
      );
    });

    mockCall.mockRejectedValueOnce(new Error("Horizon 503 unavailable"));
    const { result } = renderHook(() => useStellarAccount(VALID_ACCOUNT));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error?.message).toBe("Horizon 503 unavailable");
    });

    mockCall.mockResolvedValueOnce({
      id: VALID_ACCOUNT,
      account_id: VALID_ACCOUNT,
      sequence: "99001123",
      subentry_count: 0,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      flags: {
        auth_required: false,
        auth_revocable: false,
        auth_immutable: false,
      },
      signers: [{ key: VALID_ACCOUNT, weight: 1, type: "ed25519_public_key" }],
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.exists).toBe(true);
    expect(result.current.sequence).toBe("99001123");
  });
});
