/**
 * @jest-environment jsdom
 *
 * useAccountOperations (default template) unit tests (#1455).
 * Covers happy path (decoding typed operations, pagination with cursors, type filtering)
 * and failure modes (invalid key, 404 unfunded, 5xx server error, 4xx client error).
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const MockServer = jest.fn();
const mockOperations = jest.fn();
const mockForAccount = jest.fn();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockCursor = jest.fn();
const mockCall = jest.fn();

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  StrKey: {
    isValidEd25519PublicKey: (key: string) =>
      typeof key === "string" && key.startsWith("G") && key.length === 56,
    isValidMed25519PublicKey: (key: string) =>
      typeof key === "string" && key.startsWith("M") && key.length === 69,
  },
}));

const { useAccountOperations, decodeOperationRecord } =
  await import("../../src/templates/default/src/hooks/useAccountOperations.js");

const PUBLIC_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_KEY = "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO";
const ISSUER_KEY = "GDVNDBJKPFB3PMFP7TU5CHM4C2WJ7OYBNV6XWHV4JD7XSIUPQKFJGAAA";

const SAMPLE_RAW_OPERATIONS: any[] = [
  {
    id: "op_101",
    paging_token: "101000",
    type: "payment",
    type_i: 1,
    created_at: "2026-11-20T10:00:00Z",
    transaction_hash: "tx_hash_1",
    source_account: PUBLIC_KEY,
    from: PUBLIC_KEY,
    to: OTHER_KEY,
    amount: "50.0000000",
    asset_type: "native",
  },
  {
    id: "op_102",
    paging_token: "102000",
    type: "create_account",
    type_i: 0,
    created_at: "2026-11-21T11:00:00Z",
    transaction_hash: "tx_hash_2",
    source_account: PUBLIC_KEY,
    account: OTHER_KEY,
    starting_balance: "25.0000000",
  },
  {
    id: "op_103",
    paging_token: "103000",
    type: "change_trust",
    type_i: 6,
    created_at: "2026-11-22T12:00:00Z",
    transaction_hash: "tx_hash_3",
    source_account: PUBLIC_KEY,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER_KEY,
    limit: "10000.0000000",
  },
  {
    id: "op_104",
    paging_token: "104000",
    type: "path_payment_strict_send",
    type_i: 2,
    created_at: "2026-11-23T13:00:00Z",
    transaction_hash: "tx_hash_4",
    source_account: PUBLIC_KEY,
    to: OTHER_KEY,
    source_amount: "100.0000000",
    source_asset_type: "native",
    amount: "12.5000000",
    asset_type: "credit_alphanum4",
    asset_code: "EURC",
    asset_issuer: ISSUER_KEY,
  },
];

describe("useAccountOperations (default template #1455)", () => {
  let builder: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCall.mockResolvedValue({
      records: SAMPLE_RAW_OPERATIONS,
    });

    builder = {
      forAccount: mockForAccount.mockReturnThis(),
      order: mockOrder.mockReturnThis(),
      limit: mockLimit.mockReturnThis(),
      cursor: mockCursor.mockReturnThis(),
      call: mockCall,
    };

    mockOperations.mockReturnValue(builder);

    MockServer.mockImplementation(() => ({
      operations: mockOperations,
    }));
  });

  describe("Happy Path: Decoding & Typed Records", () => {
    it("fetches operations on mount and decodes into strongly-typed records", async () => {
      const { result } = renderHook(() => useAccountOperations(PUBLIC_KEY));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockForAccount).toHaveBeenCalledWith(PUBLIC_KEY);
      expect(result.current.loading).toBe(false);
      expect(result.current.operations.length).toBe(4);

      // Verify payment decoding
      const paymentOp = result.current.operations[0];
      expect(paymentOp.type).toBe("payment");
      expect(paymentOp.amount).toBe("50.0000000");
      expect(paymentOp.asset).toEqual({ code: "XLM", type: "native" });
      expect(paymentOp.counterparty).toBe(OTHER_KEY);

      // Verify create_account decoding
      const createAccOp = result.current.operations[1];
      expect(createAccOp.type).toBe("create_account");
      expect(createAccOp.startingBalance).toBe("25.0000000");
      expect(createAccOp.asset).toEqual({ code: "XLM", type: "native" });
      expect(createAccOp.counterparty).toBe(OTHER_KEY);

      // Verify change_trust decoding
      const trustOp = result.current.operations[2];
      expect(trustOp.type).toBe("change_trust");
      expect(trustOp.amount).toBe("10000.0000000");
      expect(trustOp.asset).toEqual({
        code: "USDC",
        issuer: ISSUER_KEY,
        type: "credit_alphanum4",
      });

      // Verify path payment decoding
      const pathOp = result.current.operations[3];
      expect(pathOp.type).toBe("path_payment_strict_send");
      expect(pathOp.sourceAmount).toBe("100.0000000");
      expect(pathOp.sourceAsset).toEqual({ code: "XLM", type: "native" });
      expect(pathOp.amount).toBe("12.5000000");
      expect(pathOp.asset).toEqual({
        code: "EURC",
        issuer: ISSUER_KEY,
        type: "credit_alphanum4",
      });
    });

    it("paginates with cursors using fetchNextPage and fetchPreviousPage", async () => {
      const { result } = renderHook(() =>
        useAccountOperations(PUBLIC_KEY, { pageSize: 2 }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.nextCursor).toBe("104000");
      expect(result.current.hasMore).toBe(true);

      // Fetch next page
      await act(async () => {
        await result.current.fetchNextPage();
      });

      expect(mockCursor).toHaveBeenCalledWith("104000");

      // Fetch previous page
      await act(async () => {
        await result.current.fetchPreviousPage();
      });

      expect(mockCall).toHaveBeenCalledTimes(3);
    });

    it("filters operations by type via option and dynamic setFilter", async () => {
      const { result } = renderHook(() =>
        useAccountOperations(PUBLIC_KEY, { typeFilter: "payment" }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.operations.length).toBe(1);
      expect(result.current.operations[0].type).toBe("payment");

      // Change filter dynamically
      await act(async () => {
        result.current.setFilter(["payment", "change_trust"]);
      });

      expect(result.current.operations.length).toBe(2);
      expect(result.current.operations.map((o) => o.type)).toEqual([
        "payment",
        "change_trust",
      ]);
    });
  });

  describe("Failure Modes", () => {
    it("failure mode 1: rejects invalid/malformed public key without querying Horizon", async () => {
      const { result } = renderHook(() => useAccountOperations("INVALID_KEY"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.error?.message).toContain(
        "Invalid Stellar address format",
      );
      expect(result.current.operations).toEqual([]);
      expect(mockOperations).not.toHaveBeenCalled();
    });

    it("failure mode 2: handles 404 unfunded account by returning empty list without throwing", async () => {
      mockCall.mockRejectedValueOnce({
        response: { status: 404 },
      });

      const { result } = renderHook(() => useAccountOperations(PUBLIC_KEY));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.operations).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.hasMore).toBe(false);
    });

    it("failure mode 3: surfaces Horizon 5xx server error", async () => {
      mockCall.mockRejectedValueOnce({
        response: { status: 503 },
        message: "Service Unavailable",
      });

      const { result } = renderHook(() => useAccountOperations(PUBLIC_KEY));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.error?.message).toContain(
        "Network error: Service Unavailable",
      );
      expect(result.current.operations).toEqual([]);
    });

    it("failure mode 4: surfaces Horizon 4xx client error with status", async () => {
      mockCall.mockRejectedValueOnce({
        response: { status: 400 },
        message: "Bad Request",
      });

      const { result } = renderHook(() => useAccountOperations(PUBLIC_KEY));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.error?.message).toContain(
        "Client error: Bad Request (Status: 400)",
      );
      expect(result.current.operations).toEqual([]);
    });
  });

  describe("decodeOperationRecord", () => {
    it("decodes payment operation amounts and assets correctly", () => {
      const decoded = decodeOperationRecord(SAMPLE_RAW_OPERATIONS[0]);
      expect(decoded.id).toBe("op_101");
      expect(decoded.type).toBe("payment");
      expect(decoded.amount).toBe("50.0000000");
      expect(decoded.asset?.code).toBe("XLM");
    });

    it("decodes create_account operations correctly", () => {
      const decoded = decodeOperationRecord(SAMPLE_RAW_OPERATIONS[1]);
      expect(decoded.id).toBe("op_102");
      expect(decoded.type).toBe("create_account");
      expect(decoded.startingBalance).toBe("25.0000000");
    });

    it("decodes change_trust asset operations correctly", () => {
      const decoded = decodeOperationRecord(SAMPLE_RAW_OPERATIONS[2]);
      expect(decoded.id).toBe("op_103");
      expect(decoded.type).toBe("change_trust");
      expect(decoded.limit).toBe("10000.0000000");
      expect(decoded.asset?.code).toBe("USDC");
      expect(decoded.asset?.issuer).toBe(ISSUER_KEY);
    });
  });
});
