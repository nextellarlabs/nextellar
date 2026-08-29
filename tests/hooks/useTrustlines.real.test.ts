/**
 * @jest-environment jsdom
 *
 * Unit tests for the real `useTrustlines` template hook (issue #820).
 *
 * The pre-existing `useTrustlines.test.ts` asserts against a local
 * `jest.fn()` stand-in rather than the hook itself, so it cannot catch a
 * regression in the hook's own logic. This suite imports the real hook and
 * stubs only the Horizon network boundary (see
 * `src/mocks/stellar-horizon-mock.ts`), leaving `Asset`, `Operation` and
 * `TransactionBuilder` as the genuine SDK implementations. Every XDR asserted
 * on below is therefore one the real SDK built and can parse back.
 *
 * Covers the issue's acceptance criteria:
 *   - listing trustlines (parsed from account balances, native filtered out)
 *   - adding a trustline (change-trust XDR with a positive limit)
 *   - removing a trustline (change-trust XDR with limit 0)
 *   - Horizon + signing are mocked
 */

import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  mockAccountCall,
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
const { useTrustlines } =
  await import("../../src/templates/default/src/hooks/useTrustlines.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

// Deterministic keypairs — derived from fixed seeds so the public keys are
// stable across runs and pass the hook's 56-char / "G" prefix validation.
const ACCOUNT_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const PUBLIC_KEY = ACCOUNT_KP.publicKey();
const SECRET = ACCOUNT_KP.secret();

const USDC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const EURC_ISSUER = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 11),
).publicKey();

const OTHER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 13));

function makeBalances() {
  return [
    { asset_type: "native", balance: "100.0000000" },
    {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC_ISSUER,
      balance: "250.0000000",
      limit: "1000000.0000000",
      is_authorized: true,
    },
    {
      asset_type: "credit_alphanum4",
      asset_code: "EURC",
      asset_issuer: EURC_ISSUER,
      balance: "0.0000000",
      limit: "500000.0000000",
      is_authorized: false,
    },
  ];
}

/** Horizon `accounts().accountId().call()` payload. */
function makeAccountResponse(balances = makeBalances()) {
  return { account_id: PUBLIC_KEY, balances };
}

/** A source account for TransactionBuilder — sequence is bumped by the SDK. */
function makeSourceAccount() {
  return new Account(PUBLIC_KEY, "5");
}

/** Build a Horizon-style error with a `response.status`, as the hook expects. */
function horizonError(status: number, message = "Horizon failure") {
  return Object.assign(new Error(message), { response: { status } });
}

/**
 * Render the hook and wait for its initial `refresh()` effect to settle, so
 * assertions don't race the first Horizon call.
 */
async function renderSettled(publicKey: string | null = PUBLIC_KEY) {
  const view = renderHook(() => useTrustlines(publicKey));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

/** Decode a change-trust XDR back into its single operation. */
function decodeChangeTrustOp(xdrString: string) {
  const tx = new Transaction(xdrString, Networks.TESTNET);
  expect(tx.operations).toHaveLength(1);
  const op = tx.operations[0] as {
    type: string;
    line: { code: string; issuer: string };
    limit: string;
  };
  expect(op.type).toBe("changeTrust");
  return op;
}

describe("useTrustlines (real template hook)", () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    resetHorizonMocks();
    // The hook logs fetch/submit failures; silence the expected noise.
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockAccountCall.mockResolvedValue(makeAccountResponse());
    mockLoadAccount.mockResolvedValue(makeSourceAccount());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // ── Listing ───────────────────────────────────────────────────────────────

  describe("listing trustlines", () => {
    it("parses non-native balances into trustlines and filters out native XLM", async () => {
      const { result } = await renderSettled();

      expect(result.current.error).toBeNull();
      expect(result.current.trustlines).toHaveLength(2);

      expect(result.current.trustlines[0]).toEqual({
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        limit: "1000000.0000000",
        balance: "250.0000000",
        authorized: true,
      });

      // Unauthorized trustlines are still listed — authorization is surfaced,
      // not used as a filter.
      expect(result.current.trustlines[1]).toMatchObject({
        asset_code: "EURC",
        authorized: false,
      });

      expect(result.current.trustlines.some((t) => t.asset_code === "")).toBe(
        false,
      );
    });

    it("returns an empty list for an account holding only native XLM", async () => {
      mockAccountCall.mockResolvedValue(
        makeAccountResponse([{ asset_type: "native", balance: "10.0000000" }]),
      );

      const { result } = await renderSettled();

      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("treats a 404 as an unfunded account rather than an error", async () => {
      mockAccountCall.mockRejectedValue(horizonError(404, "Not Found"));

      const { result } = await renderSettled();

      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("surfaces a Horizon server error", async () => {
      mockAccountCall.mockRejectedValue(horizonError(500, "boom"));

      const { result } = await renderSettled();

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toMatch(/Network error/i);
      expect(result.current.trustlines).toEqual([]);
    });

    it("does not query Horizon when no public key is supplied", async () => {
      const { result } = await renderSettled(null);

      expect(mockAccountCall).not.toHaveBeenCalled();
      expect(result.current.trustlines).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("refresh() re-reads trustlines from Horizon", async () => {
      const { result } = await renderSettled();
      expect(result.current.trustlines).toHaveLength(2);

      // Second read: the EURC trustline has been removed upstream.
      mockAccountCall.mockResolvedValue(
        makeAccountResponse(makeBalances().slice(0, 2)),
      );

      await act(async () => {
        await result.current.refresh();
      });

      await waitFor(() => expect(result.current.trustlines).toHaveLength(1));
      expect(result.current.trustlines[0].asset_code).toBe("USDC");
    });

    it("uses the configured Horizon URL", async () => {
      const horizonUrl = "https://horizon.example.test";
      const view = renderHook(() => useTrustlines(PUBLIC_KEY, { horizonUrl }));
      await waitFor(() => expect(view.result.current.loading).toBe(false));

      expect(mockHorizonServerConstructor).toHaveBeenCalledWith(horizonUrl);
    });
  });

  // ── Adding ────────────────────────────────────────────────────────────────

  describe("adding a trustline", () => {
    it("builds a change-trust XDR carrying the requested limit", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "1000000",
        });
      });

      expect(typeof xdrString).toBe("string");
      expect(xdrString.length).toBeGreaterThan(0);

      const op = decodeChangeTrustOp(xdrString);
      expect(op.line.code).toBe("USDC");
      expect(op.line.issuer).toBe(USDC_ISSUER);
      expect(parseFloat(op.limit)).toBeGreaterThan(0);

      // Unsigned — signing is the wallet's job.
      const tx = new Transaction(xdrString, Networks.TESTNET);
      expect(tx.signatures).toHaveLength(0);
    });

    it("omits the limit to get the SDK maximum (open-ended trustline)", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
        });
      });

      const op = decodeChangeTrustOp(xdrString);
      // Default is the max int64 limit, which is emphatically not a removal.
      expect(parseFloat(op.limit)).toBeGreaterThan(0);
    });

    it.each([
      ["an empty asset code", { code: "", issuer: USDC_ISSUER }],
      [
        "an over-long asset code",
        { code: "TOOLONGASSETCODE", issuer: USDC_ISSUER },
      ],
      ["a malformed issuer", { code: "USDC", issuer: "not-a-key" }],
      ["a negative limit", { code: "USDC", issuer: USDC_ISSUER, limit: "-1" }],
    ])("rejects %s", async (_label, asset) => {
      const { result } = await renderSettled();

      await expect(
        result.current.buildChangeTrustXDR(asset as never),
      ).rejects.toThrow();
    });

    it("maps a 404 on the source account to a funding hint", async () => {
      mockLoadAccount.mockRejectedValue(horizonError(404, "Not Found"));
      const { result } = await renderSettled();

      await expect(
        result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
        }),
      ).rejects.toThrow(/needs? funding|not found/i);
    });
  });

  // ── Removing ──────────────────────────────────────────────────────────────

  describe("removing a trustline (limit 0)", () => {
    it("builds a change-trust XDR with a zero limit", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "0",
        });
      });

      const op = decodeChangeTrustOp(xdrString);
      expect(op.line.code).toBe("USDC");
      expect(op.line.issuer).toBe(USDC_ISSUER);
      // A zero limit is what makes this a removal rather than an add.
      expect(parseFloat(op.limit)).toBe(0);
    });

    it("keeps the zero limit distinct from an omitted limit", async () => {
      const { result } = await renderSettled();

      let removalXdr = "";
      let openEndedXdr = "";
      await act(async () => {
        removalXdr = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "0",
        });
        openEndedXdr = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
        });
      });

      // Guards the `asset.limit ? ... : ...` branch in the hook: '0' is a
      // non-empty string and must not be treated as "no limit given".
      expect(parseFloat(decodeChangeTrustOp(removalXdr).limit)).toBe(0);
      expect(
        parseFloat(decodeChangeTrustOp(openEndedXdr).limit),
      ).toBeGreaterThan(0);
    });

    it("submits a signed removal and refreshes the list", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "0",
        });
      });

      mockSubmitTransaction.mockResolvedValue({
        hash: "removal_tx_hash",
        successful: true,
      });
      // After removal Horizon reports only the EURC trustline.
      mockAccountCall.mockResolvedValue(
        makeAccountResponse([makeBalances()[0], makeBalances()[2]]),
      );

      let submission: Awaited<
        ReturnType<typeof result.current.submitChangeTrustWithSecret>
      >;
      await act(async () => {
        submission = await result.current.submitChangeTrustWithSecret(
          xdrString,
          SECRET,
        );
      });

      expect(submission!.success).toBe(true);
      expect(submission!.hash).toBe("removal_tx_hash");

      // The transaction reaching Horizon must actually be signed.
      const submitted = mockSubmitTransaction.mock.calls[0][0] as {
        signatures: unknown[];
      };
      expect(submitted.signatures.length).toBeGreaterThan(0);

      await waitFor(() => expect(result.current.trustlines).toHaveLength(1));
      expect(result.current.trustlines[0].asset_code).toBe("EURC");
    });

    it("returns a failure result when Horizon rejects the removal", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "0",
        });
      });

      // Horizon rejects a removal while the trustline still holds a balance.
      mockSubmitTransaction.mockRejectedValue({
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: "tx_failed",
                operations: ["op_invalid_limit"],
              },
            },
          },
        },
      });

      let submission: Awaited<
        ReturnType<typeof result.current.submitChangeTrustWithSecret>
      >;
      await act(async () => {
        submission = await result.current.submitChangeTrustWithSecret(
          xdrString,
          SECRET,
        );
      });

      // Submission failures are returned, not thrown.
      expect(submission!.success).toBe(false);
      expect(submission!.error).toContain("tx_failed");
    });

    it("rejects a malformed secret key", async () => {
      const { result } = await renderSettled();

      await expect(
        result.current.submitChangeTrustWithSecret("some-xdr", "not-a-secret"),
      ).rejects.toThrow(/secret/i);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it("refuses to sign with a secret belonging to a different account", async () => {
      const { result } = await renderSettled();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildChangeTrustXDR({
          code: "USDC",
          issuer: USDC_ISSUER,
          limit: "0",
        });
      });

      let submission: Awaited<
        ReturnType<typeof result.current.submitChangeTrustWithSecret>
      >;
      await act(async () => {
        submission = await result.current.submitChangeTrustWithSecret(
          xdrString,
          OTHER_KP.secret(),
        );
      });

      expect(submission!.success).toBe(false);
      expect(submission!.error).toMatch(/does not match/i);
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });
  });
});
