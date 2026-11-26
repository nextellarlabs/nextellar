/**
 * @jest-environment jsdom
 *
 * useSponsoredReserves (default template) unit tests (#1444).
 * Covers happy path (building sponsored transaction, dual signing, submission)
 * and failure modes (validation, 404 unfunded, 5xx server error, missing signatures, submission failure).
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const MockServer = jest.fn();
const MockTransactionBuilder = jest.fn();
const MockTransaction = jest.fn();
const mockFromSecret = jest.fn();
const mockBeginSponsoring = jest.fn();
const mockEndSponsoring = jest.fn();
const mockChangeTrust = jest.fn();
const mockCreateAccount = jest.fn();

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  Keypair: {
    fromSecret: mockFromSecret,
  },
  TransactionBuilder: MockTransactionBuilder,
  Operation: {
    beginSponsoringFutureReserves: mockBeginSponsoring,
    endSponsoringFutureReserves: mockEndSponsoring,
    changeTrust: mockChangeTrust,
    createAccount: mockCreateAccount,
  },
  Networks: { TESTNET, PUBLIC },
  BASE_FEE: "100",
  Transaction: MockTransaction,
  StrKey: {
    isValidEd25519PublicKey: (key: string) =>
      typeof key === "string" && key.startsWith("G") && key.length === 56,
  },
}));

const { useSponsoredReserves } =
  await import("../../src/templates/default/src/hooks/useSponsoredReserves.js");

const SPONSOR_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const SPONSORED_KEY =
  "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO";
const SPONSOR_SECRET = "SENTINELTESTSECRET".padEnd(56, "S");
const SPONSORED_SECRET = "SENTINELTESTSECRET2".padEnd(56, "S");

const UNSIGNED_XDR = "UNSIGNED_SPONSORED_XDR".padEnd(64, "A");
const SPONSOR_SIGNED_XDR = "SPONSOR_SIGNED_XDR".padEnd(64, "B");
const DUAL_SIGNED_XDR = "DUAL_SIGNED_SPONSORED_XDR".padEnd(64, "C");

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

describe("useSponsoredReserves (default template #1444)", () => {
  let mockLoadAccount: jest.Mock<AsyncFn>;
  let mockSubmitTransaction: jest.Mock<AsyncFn>;
  let builder: {
    addOperation: jest.Mock;
    setTimeout: jest.Mock;
    build: jest.Mock;
  };
  let txInstance: {
    sign: jest.Mock;
    toXDR: jest.Mock;
    signatures: unknown[];
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLoadAccount = jest.fn<AsyncFn>().mockResolvedValue({
      accountId: () => SPONSOR_KEY,
      sequenceNumber: () => "100",
    });

    mockSubmitTransaction = jest.fn<AsyncFn>().mockResolvedValue({
      hash: "sponsored_tx_hash_123",
      successful: true,
    });

    MockServer.mockImplementation(() => ({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));

    txInstance = {
      sign: jest.fn(),
      toXDR: jest.fn().mockReturnValue(UNSIGNED_XDR),
      signatures: [{ hint: "sponsor" }, { hint: "sponsored" }],
    };

    builder = {
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue(txInstance),
    };

    MockTransactionBuilder.mockImplementation(() => builder);

    mockFromSecret.mockImplementation((sec) => ({
      publicKey: () => (sec === SPONSOR_SECRET ? SPONSOR_KEY : SPONSORED_KEY),
      secret: () => sec,
    }));

    MockTransaction.mockImplementation((xdr) => {
      if (xdr === UNSIGNED_XDR) {
        return {
          ...txInstance,
          toXDR: () => SPONSOR_SIGNED_XDR,
          signatures: [],
        };
      }
      if (xdr === SPONSOR_SIGNED_XDR) {
        return {
          ...txInstance,
          toXDR: () => DUAL_SIGNED_XDR,
          signatures: [{ hint: "sponsor" }],
        };
      }
      return {
        ...txInstance,
        toXDR: () => DUAL_SIGNED_XDR,
        signatures: [{ hint: "sponsor" }, { hint: "sponsored" }],
      };
    });
  });

  describe("Happy Path: Dual-Signature Flow & Sponsored Transaction Building", () => {
    it("builds a transaction wrapped in beginSponsoringFutureReserves / endSponsoringFutureReserves", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      const mockOp = { type: "changeTrust" } as any;
      let xdr: string = "";

      await act(async () => {
        xdr = await result.current.buildSponsoredTransaction({
          sponsor: SPONSOR_KEY,
          sponsored: SPONSORED_KEY,
          operations: [mockOp],
        });
      });

      expect(mockLoadAccount).toHaveBeenCalledWith(SPONSOR_KEY);
      expect(mockBeginSponsoring).toHaveBeenCalledWith({
        sponsoredId: SPONSORED_KEY,
      });
      expect(mockEndSponsoring).toHaveBeenCalledWith({ source: SPONSORED_KEY });
      expect(builder.addOperation).toHaveBeenCalledTimes(3);
      expect(xdr).toBe(UNSIGNED_XDR);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("signs as sponsor then as sponsored account to complete dual-signature flow", () => {
      const { result } = renderHook(() => useSponsoredReserves());

      const signedSponsor = result.current.signAsSponsor(
        UNSIGNED_XDR,
        SPONSOR_SECRET,
      );
      expect(signedSponsor).toBe(SPONSOR_SIGNED_XDR);

      const dualSigned = result.current.signAsSponsored(
        signedSponsor,
        SPONSORED_SECRET,
      );
      expect(dualSigned).toBe(DUAL_SIGNED_XDR);
    });

    it("submits a valid dual-signed transaction to Horizon", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      let submitRes: any;
      await act(async () => {
        submitRes =
          await result.current.submitSponsoredTransaction(DUAL_SIGNED_XDR);
      });

      expect(submitRes.success).toBe(true);
      expect(submitRes.hash).toBe("sponsored_tx_hash_123");
      expect(mockSubmitTransaction).toHaveBeenCalled();
    });

    it("executes submitWithSecrets end-to-end successfully", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      let submitRes: any;
      await act(async () => {
        submitRes = await result.current.submitWithSecrets(
          {
            sponsor: SPONSOR_KEY,
            sponsored: SPONSORED_KEY,
            operations: [{ type: "changeTrust" } as any],
          },
          SPONSOR_SECRET,
          SPONSORED_SECRET,
        );
      });

      expect(submitRes.success).toBe(true);
      expect(submitRes.hash).toBe("sponsored_tx_hash_123");
    });
  });

  describe("Failure Modes", () => {
    it("failure mode 1: rejects malformed sponsor/sponsored keys before contacting Horizon", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      await expect(
        result.current.buildSponsoredTransaction({
          sponsor: "INVALID",
          sponsored: SPONSORED_KEY,
          operations: [{ type: "changeTrust" } as any],
        }),
      ).rejects.toThrow("Invalid sponsor address format");

      await expect(
        result.current.buildSponsoredTransaction({
          sponsor: SPONSOR_KEY,
          sponsored: "INVALID",
          operations: [{ type: "changeTrust" } as any],
        }),
      ).rejects.toThrow("Invalid sponsored address format");

      expect(mockLoadAccount).not.toHaveBeenCalled();
    });

    it("failure mode 2: rejects when sponsor and sponsored account are the same", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      await expect(
        result.current.buildSponsoredTransaction({
          sponsor: SPONSOR_KEY,
          sponsored: SPONSOR_KEY,
          operations: [{ type: "changeTrust" } as any],
        }),
      ).rejects.toThrow(
        "Sponsor and sponsored account cannot be the same address",
      );
    });

    it("failure mode 3: rejects when no operations to sponsor are provided", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      await expect(
        result.current.buildSponsoredTransaction({
          sponsor: SPONSOR_KEY,
          sponsored: SPONSORED_KEY,
          operations: [],
        }),
      ).rejects.toThrow(
        "At least one inner operation to sponsor must be provided",
      );
    });

    it("failure mode 4: handles 404 unfunded sponsor account from Horizon", async () => {
      mockLoadAccount.mockRejectedValueOnce({
        response: { status: 404 },
      });

      const { result } = renderHook(() => useSponsoredReserves());

      let caughtErr: Error | null = null;
      await act(async () => {
        try {
          await result.current.buildSponsoredTransaction({
            sponsor: SPONSOR_KEY,
            sponsored: SPONSORED_KEY,
            operations: [{ type: "changeTrust" } as any],
          });
        } catch (err: any) {
          caughtErr = err;
        }
      });

      expect(caughtErr?.message).toContain("does not exist on the network");
      expect(result.current.error?.message).toContain(
        "does not exist on the network",
      );
    });

    it("failure mode 5: handles 500 server error from Horizon", async () => {
      mockLoadAccount.mockRejectedValueOnce({
        response: { status: 500 },
        message: "Internal server error",
      });

      const { result } = renderHook(() => useSponsoredReserves());

      let caughtErr: Error | null = null;
      await act(async () => {
        try {
          await result.current.buildSponsoredTransaction({
            sponsor: SPONSOR_KEY,
            sponsored: SPONSORED_KEY,
            operations: [{ type: "changeTrust" } as any],
          });
        } catch (err: any) {
          caughtErr = err;
        }
      });

      expect(caughtErr?.message).toContain(
        "Network error: Internal server error",
      );
      expect(result.current.error?.message).toContain(
        "Network error: Internal server error",
      );
    });

    it("failure mode 6: rejects submission if transaction lacks dual signatures", async () => {
      const { result } = renderHook(() => useSponsoredReserves());

      let submitRes: any;
      await act(async () => {
        // SPONSOR_SIGNED_XDR has only 1 signature in mock
        submitRes =
          await result.current.submitSponsoredTransaction(SPONSOR_SIGNED_XDR);
      });

      expect(submitRes.success).toBe(false);
      expect(submitRes.error).toContain("Dual signatures required");
    });

    it("failure mode 7: surfaces Horizon submission result codes on rejection", async () => {
      mockSubmitTransaction.mockRejectedValueOnce({
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

      const { result } = renderHook(() => useSponsoredReserves());

      let submitRes: any;
      await act(async () => {
        submitRes =
          await result.current.submitSponsoredTransaction(DUAL_SIGNED_XDR);
      });

      expect(submitRes.success).toBe(false);
      expect(submitRes.error).toContain("Transaction rejected by Horizon");
      expect(submitRes.error).toContain("op_bad_auth");
    });
  });
});
