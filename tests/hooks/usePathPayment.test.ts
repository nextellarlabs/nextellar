/**
 * @jest-environment jsdom
 *
 * Tests for the defi template's `usePathPayment` hook (path payments / DEX
 * swaps). Only the Horizon network boundary is mocked (see
 * `src/mocks/stellar-horizon-mock.ts`); `Operation`, `TransactionBuilder` and
 * `Transaction` are the real SDK, so every XDR asserted on was built by the
 * SDK and is decoded back here.
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

// `requireActual` is load-bearing: see stellar-horizon-mock.ts.
await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return createHorizonMock(actual);
});

const { Keypair, Account, Transaction, Networks } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");

const { usePathPayment } =
  await import("../../src/templates/defi/src/hooks/usePathPayment.js");

type PathQuote =
  import("../../src/templates/defi/src/lib/pathPayment").PathQuote;

const SENDER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const FROM = SENDER_KP.publicKey();
const SECRET = SENDER_KP.secret();
const RECIPIENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 21)).publicKey();
const USDC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const BTC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11)).publicKey();

const USDC = { code: "USDC", issuer: USDC_ISSUER };
const BTC = { code: "BTC", issuer: BTC_ISSUER };

/** A Horizon path record, as returned by the strict-send/receive endpoints. */
function pathRecord(
  sourceAmount: string,
  destinationAmount: string,
  hops: Array<{ code: string; issuer: string }> = [],
) {
  return {
    source_asset_type: "native",
    source_amount: sourceAmount,
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: USDC.code,
    destination_asset_issuer: USDC.issuer,
    destination_amount: destinationAmount,
    path: hops.map((h) => ({
      asset_type: "credit_alphanum4",
      asset_code: h.code,
      asset_issuer: h.issuer,
    })),
  };
}

function makeQuote(overrides: Partial<PathQuote> = {}): PathQuote {
  return {
    sourceAsset: "XLM",
    sourceAmount: "100.0000000",
    destinationAsset: USDC,
    destinationAmount: "12.5000000",
    path: [BTC],
    ...overrides,
  };
}

function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

function decodeSingleOp(xdr: string) {
  const tx = new Transaction(xdr, Networks.TESTNET);
  expect(tx.operations).toHaveLength(1);
  return tx.operations[0] as Record<string, unknown> & { type: string };
}

function renderPathPayment() {
  return renderHook(() => usePathPayment()).result.current;
}

describe("usePathPayment", () => {
  beforeEach(() => {
    resetHorizonMocks();
    mockLoadAccount.mockResolvedValue(new Account(FROM, "5"));
  });

  describe("findPaths", () => {
    it("queries strict-send paths for a source amount and destination asset", async () => {
      mockStrictSendPathsCall.mockResolvedValue({
        records: [pathRecord("100.0000000", "12.5000000", [BTC])],
      });
      const { findPaths } = renderPathPayment();

      const quotes = await findPaths({
        mode: "strict-send",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "100",
      });

      expect(mockStrictReceivePaths).not.toHaveBeenCalled();
      const [sourceAsset, amount, destinations] = mockStrictSendPaths.mock
        .calls[0] as unknown as [
        { isNative: () => boolean },
        string,
        Array<{ code: string; issuer: string }>,
      ];
      expect(sourceAsset.isNative()).toBe(true);
      expect(amount).toBe("100");
      expect(destinations).toHaveLength(1);
      expect(destinations[0].code).toBe("USDC");
      expect(destinations[0].issuer).toBe(USDC_ISSUER);

      expect(quotes).toEqual([
        {
          sourceAsset: "XLM",
          sourceAmount: "100.0000000",
          destinationAsset: USDC,
          destinationAmount: "12.5000000",
          path: [BTC],
        },
      ]);
    });

    it("queries strict-receive paths for a destination amount and source asset", async () => {
      mockStrictReceivePathsCall.mockResolvedValue({
        records: [pathRecord("98.0000000", "12.0000000")],
      });
      const { findPaths } = renderPathPayment();

      const quotes = await findPaths({
        mode: "strict-receive",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "12",
      });

      expect(mockStrictSendPaths).not.toHaveBeenCalled();
      const [sources, destinationAsset, amount] = mockStrictReceivePaths.mock
        .calls[0] as unknown as [
        Array<{ isNative: () => boolean }>,
        { code: string },
        string,
      ];
      expect(sources).toHaveLength(1);
      expect(sources[0].isNative()).toBe(true);
      expect(destinationAsset.code).toBe("USDC");
      expect(amount).toBe("12");
      expect(quotes[0].sourceAmount).toBe("98.0000000");
      expect(quotes[0].path).toEqual([]);
    });

    it("returns an empty list when Horizon finds no route", async () => {
      mockStrictSendPathsCall.mockResolvedValue({ records: [] });
      const { findPaths, findBestPath } = renderPathPayment();
      const params = {
        mode: "strict-send" as const,
        sourceAsset: "XLM" as const,
        destinationAsset: USDC,
        amount: "1",
      };

      expect(await findPaths(params)).toEqual([]);
      expect(await findBestPath(params)).toBeNull();
    });

    it("findBestPath picks the route that delivers the most for strict-send", async () => {
      mockStrictSendPathsCall.mockResolvedValue({
        records: [
          pathRecord("100.0000000", "12.0000000"),
          pathRecord("100.0000000", "12.9000000", [BTC]),
          pathRecord("100.0000000", "12.5000000"),
        ],
      });
      const { findBestPath } = renderPathPayment();

      const best = await findBestPath({
        mode: "strict-send",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "100",
      });

      expect(best?.destinationAmount).toBe("12.9000000");
      expect(best?.path).toEqual([BTC]);
    });

    it("findBestPath picks the cheapest route for strict-receive", async () => {
      mockStrictReceivePathsCall.mockResolvedValue({
        records: [
          pathRecord("101.0000000", "12.0000000"),
          pathRecord("97.5000000", "12.0000000", [BTC]),
        ],
      });
      const { findBestPath } = renderPathPayment();

      const best = await findBestPath({
        mode: "strict-receive",
        sourceAsset: "XLM",
        destinationAsset: USDC,
        amount: "12",
      });

      expect(best?.sourceAmount).toBe("97.5000000");
    });

    it("rejects an invalid amount before calling Horizon", async () => {
      const { findPaths } = renderPathPayment();

      await expect(
        findPaths({
          mode: "strict-send",
          sourceAsset: "XLM",
          destinationAsset: USDC,
          amount: "0",
        }),
      ).rejects.toThrow("Invalid amount");
      expect(mockStrictSendPaths).not.toHaveBeenCalled();
    });

    it("surfaces a Horizon server error", async () => {
      mockStrictSendPathsCall.mockRejectedValue(
        horizonError(503, "unavailable"),
      );
      const { findPaths } = renderPathPayment();

      await expect(
        findPaths({
          mode: "strict-send",
          sourceAsset: "XLM",
          destinationAsset: USDC,
          amount: "1",
        }),
      ).rejects.toThrow("Horizon server error: unavailable");
    });
  });

  describe("buildPathPaymentXDR", () => {
    it("strict-send: fixes the send amount and sets destMin from slippage", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      const xdr = await buildPathPaymentXDR({
        mode: "strict-send",
        from: FROM,
        to: RECIPIENT,
        quote: makeQuote(),
        slippageBps: 200,
      });

      const op = decodeSingleOp(xdr) as unknown as {
        type: string;
        sendAsset: { isNative: () => boolean };
        sendAmount: string;
        destAsset: { code: string; issuer: string };
        destMin: string;
        destination: string;
        path: Array<{ code: string; issuer: string }>;
      };
      expect(op.type).toBe("pathPaymentStrictSend");
      expect(op.sendAsset.isNative()).toBe(true);
      expect(op.sendAmount).toBe("100.0000000");
      expect(op.destAsset.code).toBe("USDC");
      // 12.5 USDC less 2% slippage.
      expect(op.destMin).toBe("12.2500000");
      expect(op.destination).toBe(RECIPIENT);
      expect(op.path.map((a) => a.code)).toEqual(["BTC"]);
    });

    it("strict-receive: fixes the receive amount and sets sendMax from slippage", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      const xdr = await buildPathPaymentXDR({
        mode: "strict-receive",
        from: FROM,
        to: RECIPIENT,
        quote: makeQuote(),
        slippageBps: 200,
      });

      const op = decodeSingleOp(xdr) as unknown as {
        type: string;
        sendMax: string;
        destAmount: string;
        destAsset: { code: string };
        path: Array<{ code: string }>;
      };
      expect(op.type).toBe("pathPaymentStrictReceive");
      // 100 XLM plus 2% slippage.
      expect(op.sendMax).toBe("102.0000000");
      expect(op.destAmount).toBe("12.5000000");
      expect(op.destAsset.code).toBe("USDC");
      expect(op.path.map((a) => a.code)).toEqual(["BTC"]);
    });

    it("defaults to a 1% slippage tolerance", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      const send = decodeSingleOp(
        await buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote(),
        }),
      ) as unknown as { destMin: string };
      const receive = decodeSingleOp(
        await buildPathPaymentXDR({
          mode: "strict-receive",
          from: FROM,
          quote: makeQuote(),
        }),
      ) as unknown as { sendMax: string };

      expect(send.destMin).toBe("12.3750000");
      expect(receive.sendMax).toBe("101.0000000");
    });

    it("swaps within the sender's own account when no recipient is given", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      const op = decodeSingleOp(
        await buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote(),
        }),
      ) as unknown as { destination: string };

      expect(op.destination).toBe(FROM);
    });

    it("supports a direct route with an empty path", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      const op = decodeSingleOp(
        await buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote({ path: [] }),
        }),
      ) as unknown as { path: unknown[] };

      expect(op.path).toEqual([]);
    });

    it("rejects invalid slippage before loading the account", async () => {
      const { buildPathPaymentXDR } = renderPathPayment();

      await expect(
        buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote(),
          slippageBps: 6000,
        }),
      ).rejects.toThrow("Slippage must be");
      expect(mockLoadAccount).not.toHaveBeenCalled();
    });

    it("reports an unfunded source account", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404));
      const { buildPathPaymentXDR } = renderPathPayment();

      await expect(
        buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote(),
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("submitSignedXDR", () => {
    it("submits a signed path payment and returns the hash", async () => {
      mockSubmitTransaction.mockResolvedValue({ hash: "abc123" });
      const { buildPathPaymentXDR, submitSignedXDR } = renderPathPayment();
      const tx = new Transaction(
        await buildPathPaymentXDR({
          mode: "strict-send",
          from: FROM,
          quote: makeQuote(),
        }),
        Networks.TESTNET,
      );
      tx.sign(SENDER_KP);

      const result = await submitSignedXDR(tx.toXDR());

      expect(result).toMatchObject({ success: true, txHash: "abc123" });
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it("surfaces Stellar result codes when the swap fails (e.g. slippage exceeded)", async () => {
      mockSubmitTransaction.mockRejectedValue({
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: "tx_failed",
                operations: ["op_under_dest_min"],
              },
            },
          },
        },
      });
      const { buildPathPaymentXDR, submitSignedXDR } = renderPathPayment();
      const xdr = await buildPathPaymentXDR({
        mode: "strict-send",
        from: FROM,
        quote: makeQuote(),
      });

      const result = await submitSignedXDR(xdr);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/slippage tolerance exceeded/i);
      expect(result.resultCodes).toEqual({
        transaction: "tx_failed",
        operations: ["op_under_dest_min"],
      });
    });

    it("rejects an empty XDR without calling Horizon", async () => {
      const { submitSignedXDR } = renderPathPayment();

      const result = await submitSignedXDR("");

      expect(result.success).toBe(false);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  describe("signAndSubmitWithSecret (dev only)", () => {
    it("signs with the secret and submits a strict-receive swap", async () => {
      mockSubmitTransaction.mockResolvedValue({ hash: "def456" });
      const { signAndSubmitWithSecret } = renderPathPayment();

      const result = await signAndSubmitWithSecret({
        mode: "strict-receive",
        from: FROM,
        quote: makeQuote(),
        secret: SECRET,
      });

      expect(result).toMatchObject({ success: true, txHash: "def456" });
      const submitted = mockSubmitTransaction.mock.calls[0][0] as unknown as {
        signatures: unknown[];
        operations: Array<{ type: string }>;
      };
      expect(submitted.signatures).toHaveLength(1);
      expect(submitted.operations[0].type).toBe("pathPaymentStrictReceive");
    });

    it("refuses a secret that does not match the sender", async () => {
      const { signAndSubmitWithSecret } = renderPathPayment();

      const result = await signAndSubmitWithSecret({
        mode: "strict-send",
        from: RECIPIENT,
        quote: makeQuote(),
        secret: SECRET,
      });

      expect(result).toEqual({
        success: false,
        error: "Secret key does not match sender address",
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });
});
