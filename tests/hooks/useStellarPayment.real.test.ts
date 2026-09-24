/**
 * @jest-environment jsdom
 *
 * Unit tests for the real `useStellarPayment` template hook (issue #819).
 *
 * The pre-existing `useStellarPayment.test.ts` asserts against a local
 * `jest.fn()` stand-in rather than the hook itself, so it cannot catch a
 * regression in the hook's own logic. This suite imports the real hook and
 * stubs only the Horizon network boundary (see
 * `src/mocks/stellar-horizon-mock.ts`), leaving `Keypair`, `Asset`,
 * `Operation`, `TransactionBuilder` and `Transaction` as the genuine SDK
 * implementations — so signing is real and every XDR asserted on below is one
 * the SDK actually built and can parse back.
 *
 * Covers the issue's acceptance criteria:
 *   - a successful payment
 *   - a failed submission, with the error surfaced to the caller
 *   - signing + submission are mocked at the network boundary
 */

import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const {
  mockLoadAccount,
  mockSubmitTransaction,
  mockHorizonServerConstructor,
  resetHorizonMocks,
  createHorizonMock,
} = await import("../../src/mocks/stellar-horizon-mock.js");

// `requireActual` is load-bearing: without it the mock's view of the SDK
// resolves back to the mock itself and the Jest worker hangs on the cycle.
await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return createHorizonMock(actual);
});

// Pull the SDK classes through the mocked specifier so the hook and the test
// agree on class identity (a Transaction built here must be signable there).
const { Keypair, Account, Transaction, Networks } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");

// Import the REAL hook. Its '@stellar/stellar-sdk' import resolves to the mock
// registered above; its '../contexts' import is redirected to the wallet mock
// by jest.config moduleNameMapper.
const { useStellarPayment } =
  await import("../../src/templates/default/src/hooks/useStellarPayment.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

// Deterministic keypairs — derived from fixed seeds so the public keys are
// stable across runs and pass the hook's 56-char / "G" prefix validation.
const SENDER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const FROM = SENDER_KP.publicKey();
const SECRET = SENDER_KP.secret();

const TO = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 21)).publicKey();
const USDC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();

const OTHER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13));

/** A source account for TransactionBuilder — sequence is bumped by the SDK. */
function makeSourceAccount() {
  return new Account(FROM, "5");
}

function validPayment(overrides: Record<string, unknown> = {}) {
  return { from: FROM, to: TO, amount: "10", ...overrides };
}

/** Build a Horizon-style error with a `response.status`, as the hook expects. */
function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

/**
 * A Horizon submission rejection carrying Stellar result codes, which is what
 * a real failed submission looks like (e.g. insufficient balance).
 */
function submissionRejection(
  result_codes: { transaction?: string; operations?: string[] } = {
    transaction: "tx_failed",
    operations: ["op_underfunded"],
  },
) {
  return {
    response: { status: 400, data: { extras: { result_codes } } },
  };
}

/** Sign a built XDR with the sender's key, as an external wallet would. */
function signAsWallet(unsignedXdr: string, keypair = SENDER_KP) {
  const tx = new Transaction(unsignedXdr, Networks.TESTNET);
  tx.sign(keypair);
  return tx.toXDR();
}

function renderPaymentHook() {
  return renderHook(() => useStellarPayment());
}

describe("useStellarPayment (real template hook)", () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    resetHorizonMocks();
    // The hook logs submission failures; silence the expected noise.
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLoadAccount.mockResolvedValue(makeSourceAccount());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("exposes the payment API", () => {
    const { result } = renderPaymentHook();

    expect(typeof result.current.buildPaymentXDR).toBe("function");
    expect(typeof result.current.submitSignedXDR).toBe("function");
    expect(typeof result.current.signAndSubmitWithSecret).toBe("function");
  });

  // ── Successful payment ────────────────────────────────────────────────────

  describe("a successful payment", () => {
    it("builds an unsigned native-asset payment XDR", async () => {
      const { result } = renderPaymentHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildPaymentXDR(validPayment());
      });

      const tx = new Transaction(xdrString, Networks.TESTNET);
      expect(tx.source).toBe(FROM);
      expect(tx.operations).toHaveLength(1);

      const op = tx.operations[0] as {
        type: string;
        destination: string;
        amount: string;
        asset: { isNative(): boolean };
      };
      expect(op.type).toBe("payment");
      expect(op.destination).toBe(TO);
      expect(op.amount).toBe("10.0000000");
      expect(op.asset.isNative()).toBe(true);

      // Unsigned — signing is the wallet's job.
      expect(tx.signatures).toHaveLength(0);
      expect(mockLoadAccount).toHaveBeenCalledWith(FROM);
    });

    it("builds a payment for an issued asset with a memo", async () => {
      const { result } = renderPaymentHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildPaymentXDR(
          validPayment({
            asset: { code: "USDC", issuer: USDC_ISSUER },
            memo: "invoice-42",
          }),
        );
      });

      const tx = new Transaction(xdrString, Networks.TESTNET);
      const op = tx.operations[0] as {
        asset: { code: string; issuer: string };
      };
      expect(op.asset.code).toBe("USDC");
      expect(op.asset.issuer).toBe(USDC_ISSUER);
      expect(tx.memo.value?.toString()).toBe("invoice-42");
    });

    it("submits a signed XDR and returns the transaction hash", async () => {
      const { result } = renderPaymentHook();

      let unsignedXdr = "";
      await act(async () => {
        unsignedXdr = await result.current.buildPaymentXDR(validPayment());
      });

      mockSubmitTransaction.mockResolvedValue({
        hash: "payment_tx_hash",
        successful: true,
      });

      let payment: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
      await act(async () => {
        payment = await result.current.submitSignedXDR(
          signAsWallet(unsignedXdr),
        );
      });

      expect(payment!.success).toBe(true);
      expect(payment!.txHash).toBe("payment_tx_hash");
      expect(payment!.error).toBeUndefined();

      // The transaction reaching Horizon must actually carry a signature.
      const submitted = mockSubmitTransaction.mock.calls[0][0] as {
        signatures: unknown[];
      };
      expect(submitted.signatures.length).toBeGreaterThan(0);
    });

    it("signs and submits end to end with a secret key", async () => {
      const { result } = renderPaymentHook();

      mockSubmitTransaction.mockResolvedValue({
        hash: "signed_tx_hash",
        successful: true,
      });

      let payment: Awaited<
        ReturnType<typeof result.current.signAndSubmitWithSecret>
      >;
      await act(async () => {
        payment = await result.current.signAndSubmitWithSecret({
          ...validPayment(),
          secret: SECRET,
        });
      });

      expect(payment!.success).toBe(true);
      expect(payment!.txHash).toBe("signed_tx_hash");

      const submitted = mockSubmitTransaction.mock.calls[0][0] as {
        signatures: unknown[];
        source: string;
      };
      expect(submitted.source).toBe(FROM);
      expect(submitted.signatures.length).toBeGreaterThan(0);
    });

    it("uses the configured Horizon URL", async () => {
      const horizonUrl = "https://horizon.example.test";
      renderHook(() => useStellarPayment({ horizonUrl }));

      expect(mockHorizonServerConstructor).toHaveBeenCalledWith(horizonUrl);
    });
  });

  // ── Failed submission ─────────────────────────────────────────────────────

  describe("a failed submission", () => {
    it("surfaces Stellar result codes rather than throwing", async () => {
      const { result } = renderPaymentHook();

      let unsignedXdr = "";
      await act(async () => {
        unsignedXdr = await result.current.buildPaymentXDR(validPayment());
      });

      mockSubmitTransaction.mockRejectedValue(submissionRejection());

      let payment: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
      await act(async () => {
        // Resolves to a failure result; a rejected promise here would be a bug.
        payment = await result.current.submitSignedXDR(
          signAsWallet(unsignedXdr),
        );
      });

      expect(payment!.success).toBe(false);
      expect(payment!.txHash).toBeUndefined();
      // The underlying reason must reach the caller, not a generic message.
      expect(payment!.error).toContain("tx_failed");
      expect(payment!.raw).toEqual(submissionRejection().response.data);
    });

    it("falls back to the operation code when no transaction code is given", async () => {
      const { result } = renderPaymentHook();

      let unsignedXdr = "";
      await act(async () => {
        unsignedXdr = await result.current.buildPaymentXDR(validPayment());
      });

      // No `transaction` code — only operation codes, as Horizon returns for
      // some operation-level failures.
      mockSubmitTransaction.mockRejectedValue(
        submissionRejection({ operations: ["op_no_destination"] }),
      );

      let payment: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
      await act(async () => {
        payment = await result.current.submitSignedXDR(
          signAsWallet(unsignedXdr),
        );
      });

      expect(payment!.success).toBe(false);
      expect(payment!.error).toContain("op_no_destination");
    });

    it("reports a Horizon server error during submission", async () => {
      const { result } = renderPaymentHook();

      let unsignedXdr = "";
      await act(async () => {
        unsignedXdr = await result.current.buildPaymentXDR(validPayment());
      });

      mockSubmitTransaction.mockRejectedValue(horizonError(503, "unavailable"));

      let payment: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
      await act(async () => {
        payment = await result.current.submitSignedXDR(
          signAsWallet(unsignedXdr),
        );
      });

      expect(payment!.success).toBe(false);
      expect(payment!.error).toMatch(/server error/i);
    });

    it("surfaces a submission failure through signAndSubmitWithSecret", async () => {
      const { result } = renderPaymentHook();

      mockSubmitTransaction.mockRejectedValue(submissionRejection());

      let payment: Awaited<
        ReturnType<typeof result.current.signAndSubmitWithSecret>
      >;
      await act(async () => {
        payment = await result.current.signAndSubmitWithSecret({
          ...validPayment(),
          secret: SECRET,
        });
      });

      expect(payment!.success).toBe(false);
      expect(payment!.error).toContain("tx_failed");
    });

    it("reports an unfunded source account when the build fails", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404, "Not Found"));
      const { result } = renderPaymentHook();

      await expect(
        result.current.buildPaymentXDR(validPayment()),
      ).rejects.toThrow(/not found|funding/i);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("rejects a corrupted signed XDR before reaching the network", async () => {
      const { result } = renderPaymentHook();

      await expect(result.current.submitSignedXDR("too-short")).rejects.toThrow(
        /invalid signed transaction/i,
      );
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("returns a failure when the secret does not match the sender", async () => {
      const { result } = renderPaymentHook();

      let payment: Awaited<
        ReturnType<typeof result.current.signAndSubmitWithSecret>
      >;
      await act(async () => {
        payment = await result.current.signAndSubmitWithSecret({
          ...validPayment(),
          secret: OTHER_KP.secret(),
        });
      });

      expect(payment!.success).toBe(false);
      expect(payment!.error).toMatch(/does not match/i);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("returns a failure for a malformed secret", async () => {
      const { result } = renderPaymentHook();

      let payment: Awaited<
        ReturnType<typeof result.current.signAndSubmitWithSecret>
      >;
      await act(async () => {
        payment = await result.current.signAndSubmitWithSecret({
          ...validPayment(),
          secret: "not-a-secret",
        });
      });

      expect(payment!.success).toBe(false);
      expect(payment!.error).toMatch(/secret/i);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Parameter validation ──────────────────────────────────────────────────

  describe("parameter validation", () => {
    it.each([
      ["a malformed sender", validPayment({ from: "not-a-key" })],
      ["a malformed recipient", validPayment({ to: "not-a-key" })],
      ["a zero amount", validPayment({ amount: "0" })],
      ["a negative amount", validPayment({ amount: "-5" })],
      ["a non-numeric amount", validPayment({ amount: "abc" })],
      ["a self-payment", validPayment({ to: FROM })],
      [
        "a malformed asset issuer",
        validPayment({ asset: { code: "USDC", issuer: "nope" } }),
      ],
      ["an over-long memo", validPayment({ memo: "x".repeat(29) })],
    ])("rejects %s", async (_label, params) => {
      const { result } = renderPaymentHook();

      await expect(
        result.current.buildPaymentXDR(params as never),
      ).rejects.toThrow();
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });
});
