/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  act,
  DEFAULT_PAGE_SIZE as PAGE_SIZE,
  flush,
  INVALID_PUBLIC_KEY_NO_G as INVALID_KEY_NO_G,
  INVALID_PUBLIC_KEY_SHORT as INVALID_KEY_SHORT,
  makeHorizonPage as makePage,
  makeHorizonResponse as makeResponse,
  PUBLIC_KEY as VALID_PUBLIC_KEY,
  PUBLIC_KEY_2 as VALID_PUBLIC_KEY_2,
  renderHook,
  silenceConsole,
} from "../helpers";

await jest.unstable_mockModule(
  "@stellar/stellar-sdk",
  async () => await import("../../src/mocks/stellar-sdk-mock.js"),
);

// Import the shared SDK mock – gives us control over Horizon.Server methods.
const {
  mockHorizonCall,
  mockHorizonServerConstructor,
  mockPayments,
  mockOperations,
} = await import("../../src/mocks/stellar-sdk-mock.js");

// The hook's '../contexts' import is redirected to wallet-contexts-mock.ts
// via jest.config moduleNameMapper, so useWalletConfig() returns undefined.

// Import the REAL hook – its SDK dependency is resolved to the shared mock.
const { useTransactionHistory } =
  await import("../../src/templates/default/src/hooks/useTransactionHistory.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTransactionHistory (Template Hook)", () => {
  let restoreConsole: () => void;
  let consoleWarnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    restoreConsole = silenceConsole(["error"]);
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    restoreConsole();
    consoleWarnSpy.mockRestore();
  });

  // ── 1. Return shape ─────────────────────────────────────────────────────

  it("should return the correct public API shape", async () => {
    mockHorizonCall.mockResolvedValue(makeResponse([]));

    const { result } = renderHook(() =>
      useTransactionHistory(VALID_PUBLIC_KEY),
    );
    await flush();

    expect(Array.isArray(result.current.items)).toBe(true);
    expect(typeof result.current.loading).toBe("boolean");
    expect(typeof result.current.fetchNextPage).toBe("function");
    expect(typeof result.current.refresh).toBe("function");
    expect(typeof result.current.hasMore).toBe("boolean");
    expect(result.current.error).toBeNull();
  });

  // ── 2. Initial fetch ────────────────────────────────────────────────────

  describe("initial fetch returns paginated results", () => {
    it("should return first page of transactions with correct shape", async () => {
      const page1 = makePage(0, PAGE_SIZE);
      mockHorizonCall.mockResolvedValue(makeResponse(page1));

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();

      expect(result.current.items).toHaveLength(PAGE_SIZE);
      expect(result.current.items[0].id).toBe("op-0");
      expect(result.current.items[9].id).toBe("op-9");
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should set hasMore to true when a full page with next cursor is returned", async () => {
      const page = makePage(0, PAGE_SIZE);
      mockHorizonCall.mockResolvedValue(makeResponse(page));

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();

      expect(result.current.hasMore).toBe(true);
    });

    it("should set hasMore to false when fewer records than pageSize are returned", async () => {
      const partialPage = makePage(0, 3);
      mockHorizonCall.mockResolvedValue(makeResponse(partialPage));

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();

      expect(result.current.hasMore).toBe(false);
    });

    it("should return empty items when no publicKey is provided", async () => {
      const { result } = renderHook(() => useTransactionHistory(null));
      await flush();

      expect(result.current.items).toHaveLength(0);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockHorizonCall).not.toHaveBeenCalled();
    });
  });

  // ── 3. Load more (fetchNextPage) ────────────────────────────────────────

  describe("loadMore appends new records and advances cursor", () => {
    it("should append second page when fetchNextPage is called", async () => {
      // First page
      const page1 = makePage(0, PAGE_SIZE);
      mockHorizonCall.mockResolvedValueOnce(makeResponse(page1));

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();
      expect(result.current.items).toHaveLength(PAGE_SIZE);

      // Second page
      const page2 = makePage(10, PAGE_SIZE);
      mockHorizonCall.mockResolvedValueOnce(makeResponse(page2));

      await act(async () => {
        await result.current.fetchNextPage();
      });

      expect(result.current.items).toHaveLength(PAGE_SIZE * 2);
      expect(result.current.items[0].id).toBe("op-0");
      expect(result.current.items[10].id).toBe("op-10");
      expect(result.current.items[19].id).toBe("op-19");
    });

    it("should advance cursor across multiple fetchNextPage calls", async () => {
      // Page 1
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(0, PAGE_SIZE)),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();

      // Page 2
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(10, PAGE_SIZE)),
      );
      await act(async () => {
        await result.current.fetchNextPage();
      });

      // Page 3
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(20, PAGE_SIZE)),
      );
      await act(async () => {
        await result.current.fetchNextPage();
      });

      expect(result.current.items).toHaveLength(PAGE_SIZE * 3);
      expect(result.current.items[20].id).toBe("op-20");
      expect(result.current.items[29].id).toBe("op-29");

      // The builder .cursor() should have been called with advancing tokens
      // Call 0 = initial (no cursor), Call 1 = pt-9, Call 2 = pt-19
      const cursorCalls = mockHorizonCall.mock.calls;
      expect(cursorCalls.length).toBe(3);
    });

    it("should set hasMore to false when fetchNextPage returns fewer than pageSize", async () => {
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(0, PAGE_SIZE)),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();
      expect(result.current.hasMore).toBe(true);

      // Partial page signals end of data
      mockHorizonCall.mockResolvedValueOnce(makeResponse(makePage(10, 3)));
      await act(async () => {
        await result.current.fetchNextPage();
      });

      expect(result.current.hasMore).toBe(false);
      expect(result.current.items).toHaveLength(PAGE_SIZE + 3);
    });
  });

  // ── 4. Memory limit enforcement ─────────────────────────────────────────

  describe("memory limit enforcement (cap at 1000 items)", () => {
    it("should trim oldest items when exceeding 1000 items", async () => {
      // Seed with 995 items via initial fetch
      const bigPage = makePage(0, 995);
      mockHorizonCall.mockResolvedValueOnce(makeResponse(bigPage));

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: 995 }),
      );
      await flush();
      expect(result.current.items).toHaveLength(995);

      // Next page pushes us to 1005 → should trim to 1000
      const overflowPage = makePage(995, 10);
      mockHorizonCall.mockResolvedValueOnce(makeResponse(overflowPage));

      await act(async () => {
        await result.current.fetchNextPage();
      });

      expect(result.current.items).toHaveLength(1000);
      // Oldest items (0-4) should be dropped; first item should be op-5
      expect(result.current.items[0].id).toBe("op-5");
      expect(result.current.items[999].id).toBe("op-1004");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("trimmed to 1000"),
      );
    });
  });

  // ── 5. State reset on publicKey change ──────────────────────────────────

  describe("state reset when publicKey changes", () => {
    it("should clear items and reset cursor when publicKey changes", async () => {
      // First key fetches data
      mockHorizonCall.mockResolvedValueOnce(makeResponse(makePage(0, 5)));

      const { result, rerender } = renderHook(
        ({ pk }: { pk: string }) =>
          useTransactionHistory(pk, { pageSize: PAGE_SIZE }),
        { initialProps: { pk: VALID_PUBLIC_KEY } },
      );
      await flush();
      expect(result.current.items).toHaveLength(5);

      // Switch to a different public key — state should reset and new fetch occurs
      mockHorizonCall.mockResolvedValueOnce(makeResponse(makePage(100, 3)));

      rerender({ pk: VALID_PUBLIC_KEY_2 });
      await flush();

      expect(result.current.items).toHaveLength(3);
      expect(result.current.items[0].id).toBe("op-100");
    });

    it("should clear items when publicKey becomes null", async () => {
      mockHorizonCall.mockResolvedValueOnce(makeResponse(makePage(0, 5)));

      const { result, rerender } = renderHook(
        ({ pk }: { pk: string | null }) =>
          useTransactionHistory(pk, { pageSize: PAGE_SIZE }),
        { initialProps: { pk: VALID_PUBLIC_KEY as string | null } },
      );
      await flush();
      expect(result.current.items).toHaveLength(5);

      rerender({ pk: null });
      await flush();

      expect(result.current.items).toHaveLength(0);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // ── 6. Error handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("should set error for invalid (too-short) public key", async () => {
      mockHorizonCall.mockRejectedValue(
        new Error("Invalid Stellar public key format"),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(INVALID_KEY_SHORT),
      );
      await flush();

      expect(result.current.error).toBeTruthy();
      expect(result.current.error?.message).toContain(
        "Invalid Stellar public key",
      );
    });

    it("should set error for public key not starting with G", async () => {
      mockHorizonCall.mockRejectedValue(
        new Error("Invalid Stellar public key format"),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(INVALID_KEY_NO_G),
      );
      await flush();

      expect(result.current.error).toBeTruthy();
      expect(result.current.error?.message).toContain(
        "Invalid Stellar public key",
      );
    });

    it("should set error on network failure", async () => {
      mockHorizonCall.mockRejectedValue(
        Object.assign(new Error("fetch failed"), {
          response: { status: 500 },
        }),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY),
      );
      await flush();

      expect(result.current.error).toBeTruthy();
      expect(result.current.loading).toBe(false);
    });

    it("should preserve previous items when an error occurs on fetchNextPage", async () => {
      // Successful first page
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(0, PAGE_SIZE)),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();
      expect(result.current.items).toHaveLength(PAGE_SIZE);

      // Second page fails
      mockHorizonCall.mockRejectedValueOnce(new Error("Network timeout"));

      await act(async () => {
        await result.current.fetchNextPage();
      });

      // Items from the first page should still be present
      expect(result.current.items).toHaveLength(PAGE_SIZE);
      expect(result.current.error).toBeTruthy();
    });
  });

  // ── 7. 404 account (not found / unfunded) ──────────────────────────────

  describe("404 account not found", () => {
    it("should return empty array with no error when Horizon returns 404", async () => {
      const notFoundError = Object.assign(new Error("Account not found"), {
        response: { status: 404 },
        name: "NotFoundError",
      });
      mockHorizonCall.mockRejectedValue(notFoundError);

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY),
      );
      await flush();

      expect(result.current.items).toHaveLength(0);
      expect(result.current.error).toBeNull();
      expect(result.current.hasMore).toBe(false);
    });
  });

  // ── 8. Operation type toggle ────────────────────────────────────────────

  describe("operation type toggle (payments vs operations)", () => {
    it("should call payments() when type is 'payments'", async () => {
      mockHorizonCall.mockResolvedValue(makeResponse(makePage(0, 5)));

      renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { type: "payments" }),
      );
      await flush();

      expect(mockPayments).toHaveBeenCalled();
    });

    it("should call operations() when type is 'operations'", async () => {
      mockHorizonCall.mockResolvedValue(makeResponse(makePage(0, 5)));

      renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { type: "operations" }),
      );
      await flush();

      expect(mockOperations).toHaveBeenCalled();
    });

    it("should default to operations when no type is specified", async () => {
      mockHorizonCall.mockResolvedValue(makeResponse(makePage(0, 5)));

      renderHook(() => useTransactionHistory(VALID_PUBLIC_KEY));
      await flush();

      expect(mockOperations).toHaveBeenCalled();
    });
  });

  // ── 9. Refresh ──────────────────────────────────────────────────────────

  describe("refresh", () => {
    it("should reset items and fetch from the beginning", async () => {
      // Initial fetch
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(0, PAGE_SIZE)),
      );

      const { result } = renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, { pageSize: PAGE_SIZE }),
      );
      await flush();
      expect(result.current.items).toHaveLength(PAGE_SIZE);

      // Load second page
      mockHorizonCall.mockResolvedValueOnce(
        makeResponse(makePage(10, PAGE_SIZE)),
      );
      await act(async () => {
        await result.current.fetchNextPage();
      });
      expect(result.current.items).toHaveLength(PAGE_SIZE * 2);

      // Refresh should reset to fresh first page
      const freshPage = makePage(50, 5);
      mockHorizonCall.mockResolvedValueOnce(makeResponse(freshPage));
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.items).toHaveLength(5);
      expect(result.current.items[0].id).toBe("op-50");
    });
  });

  // ── 10. Horizon server initialization ───────────────────────────────────

  describe("Horizon server initialization", () => {
    it("should create Horizon.Server with the provided URL", async () => {
      mockHorizonCall.mockResolvedValue(makeResponse([]));

      renderHook(() =>
        useTransactionHistory(VALID_PUBLIC_KEY, {
          horizonUrl: "https://horizon.stellar.org",
        }),
      );
      await flush();

      expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
        "https://horizon.stellar.org",
      );
    });

    it("should default to testnet Horizon URL", async () => {
      mockHorizonCall.mockResolvedValue(makeResponse([]));

      renderHook(() => useTransactionHistory(VALID_PUBLIC_KEY));
      await flush();

      expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
        "https://horizon-testnet.stellar.org",
      );
    });
  });
});
