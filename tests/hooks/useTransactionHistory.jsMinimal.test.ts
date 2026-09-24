/**
 * @jest-environment jsdom
 *
 * useTransactionHistory (js-minimal template) unit tests (#1021).
 *
 * Ports the `minimal` (TS) hook's pagination/polling contract to the
 * js-minimal template. Exercises the REAL js hook at
 * src/templates/js-minimal/src/hooks/useTransactionHistory — not a mocked
 * stand-in — while the Stellar SDK is swapped for the shared Horizon mock so
 * no live network call is ever made.
 */
import { jest } from "@jest/globals";
import {
  act,
  DEFAULT_PAGE_SIZE,
  flush,
  INVALID_PUBLIC_KEY_NO_G,
  INVALID_PUBLIC_KEY_SHORT,
  makeHorizonPage,
  makeHorizonResponse,
  PUBLIC_KEY,
  PUBLIC_KEY_2,
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
// via jest.config moduleNameMapper, so useWalletConfig() returns undefined
// and the hook falls back to its default Horizon URL.

// Import the REAL js-minimal hook – its SDK dependency resolves to the mock.
const { useTransactionHistory } = await import(
  "../../src/templates/js-minimal/src/hooks/useTransactionHistory"
);

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

describe("useTransactionHistory (js-minimal template)", () => {
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

  it("exposes the pagination API with the same shape as the TS hook", async () => {
    mockHorizonCall.mockResolvedValue(makeHorizonResponse([]));

    const { result } = renderHook(() => useTransactionHistory(PUBLIC_KEY));
    await flush();

    expect(Array.isArray(result.current.items)).toBe(true);
    expect(typeof result.current.loading).toBe("boolean");
    expect(typeof result.current.fetchNextPage).toBe("function");
    expect(typeof result.current.refresh).toBe("function");
    expect(typeof result.current.hasMore).toBe("boolean");
    expect(result.current.error).toBeNull();
  });

  // ── 2. Initial fetch ────────────────────────────────────────────────────

  it("fetches the first page and reports hasMore", async () => {
    mockHorizonCall.mockResolvedValue(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();

    expect(result.current.items).toHaveLength(PAGE_SIZE);
    expect(result.current.items[0].id).toBe("op-0");
    expect(result.current.items[PAGE_SIZE - 1].id).toBe(`op-${PAGE_SIZE - 1}`);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
  });

  it("sets hasMore to false when fewer records than pageSize are returned", async () => {
    mockHorizonCall.mockResolvedValue(
      makeHorizonResponse(makeHorizonPage(0, 3)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();

    expect(result.current.hasMore).toBe(false);
  });

  it("returns an empty list without fetching when no publicKey is provided", async () => {
    const { result } = renderHook(() => useTransactionHistory(null));
    await flush();

    expect(result.current.items).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockHorizonCall).not.toHaveBeenCalled();
  });

  // ── 3. Pagination (fetchNextPage) ───────────────────────────────────────

  it("appends the next page and advances the cursor across pages", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();
    expect(result.current.items).toHaveLength(PAGE_SIZE);

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(10, PAGE_SIZE)),
    );
    await act(async () => {
      await result.current.fetchNextPage();
    });

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(20, PAGE_SIZE)),
    );
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.items).toHaveLength(PAGE_SIZE * 3);
    expect(result.current.items[20].id).toBe("op-20");
    expect(result.current.items[29].id).toBe("op-29");
    // One initial request plus one per fetchNextPage call.
    expect(mockHorizonCall).toHaveBeenCalledTimes(3);
  });

  it("does not duplicate the boundary record if it reappears on the next page", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();
    const lastOfPage1 = result.current.items[PAGE_SIZE - 1];

    // Horizon cursors are meant to be exclusive, but a record at the exact
    // page boundary can come back on the following page too.
    const overlappingPage2 = [lastOfPage1, ...makeHorizonPage(10, PAGE_SIZE - 1)];
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(overlappingPage2),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    const ids = result.current.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === `op-${PAGE_SIZE - 1}`)).toHaveLength(1);
    expect(result.current.items).toHaveLength(PAGE_SIZE * 2 - 1);
  });

  it("stops hasMore when fetchNextPage returns a partial page", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();
    expect(result.current.hasMore).toBe(true);

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(10, 3)),
    );
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.hasMore).toBe(false);
    expect(result.current.items).toHaveLength(PAGE_SIZE + 3);
  });

  // ── 4. Refresh ──────────────────────────────────────────────────────────

  it("refresh resets items and re-fetches from the beginning", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(10, PAGE_SIZE)),
    );
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(result.current.items).toHaveLength(PAGE_SIZE * 2);

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(50, 5)),
    );
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toHaveLength(5);
    expect(result.current.items[0].id).toBe("op-50");
  });

  // ── 5. State reset on publicKey change ──────────────────────────────────

  it("resets items and cursor when publicKey changes", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, 5)),
    );

    const { result, rerender } = renderHook(
      ({ pk }: { pk: string | null }) =>
        useTransactionHistory(pk, { pageSize: PAGE_SIZE }),
      { initialProps: { pk: PUBLIC_KEY as string | null } },
    );
    await flush();
    expect(result.current.items).toHaveLength(5);

    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(100, 3)),
    );
    rerender({ pk: PUBLIC_KEY_2 });
    await flush();

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[0].id).toBe("op-100");
  });

  it("clears items when publicKey becomes null", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, 5)),
    );

    const { result, rerender } = renderHook(
      ({ pk }: { pk: string | null }) =>
        useTransactionHistory(pk, { pageSize: PAGE_SIZE }),
      { initialProps: { pk: PUBLIC_KEY as string | null } },
    );
    await flush();
    expect(result.current.items).toHaveLength(5);

    rerender({ pk: null });
    await flush();

    expect(result.current.items).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── 6. Error handling ───────────────────────────────────────────────────

  it("surfaces an error for a malformed (too-short) public key", async () => {
    mockHorizonCall.mockRejectedValue(
      new Error("Invalid Stellar public key format"),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(INVALID_PUBLIC_KEY_SHORT),
    );
    await flush();

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain(
      "Invalid Stellar public key",
    );
  });

  it("surfaces an error for a public key not starting with G", async () => {
    mockHorizonCall.mockRejectedValue(
      new Error("Invalid Stellar public key format"),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(INVALID_PUBLIC_KEY_NO_G),
    );
    await flush();

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain(
      "Invalid Stellar public key",
    );
  });

  it("surfaces a network error and clears loading", async () => {
    mockHorizonCall.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { response: { status: 500 } }),
    );

    const { result } = renderHook(() => useTransactionHistory(PUBLIC_KEY));
    await flush();

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.loading).toBe(false);
  });

  it("keeps previously loaded items when fetchNextPage fails", async () => {
    mockHorizonCall.mockResolvedValueOnce(
      makeHorizonResponse(makeHorizonPage(0, PAGE_SIZE)),
    );

    const { result } = renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { pageSize: PAGE_SIZE }),
    );
    await flush();
    expect(result.current.items).toHaveLength(PAGE_SIZE);

    mockHorizonCall.mockRejectedValueOnce(new Error("Network timeout"));
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.items).toHaveLength(PAGE_SIZE);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // ── 7. Unfunded account (404) ───────────────────────────────────────────

  it("returns an empty list (not an error) for a 404 — an unfunded account", async () => {
    mockHorizonCall.mockRejectedValue(
      Object.assign(new Error("Account not found"), {
        response: { status: 404 },
        name: "NotFoundError",
      }),
    );

    const { result } = renderHook(() => useTransactionHistory(PUBLIC_KEY));
    await flush();

    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  // ── 8. Operation type toggle ────────────────────────────────────────────

  it("uses payments() when type is 'payments'", async () => {
    mockHorizonCall.mockResolvedValue(
      makeHorizonResponse(makeHorizonPage(0, 5)),
    );

    renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, { type: "payments" }),
    );
    await flush();

    expect(mockPayments).toHaveBeenCalled();
  });

  it("defaults to operations() when no type is specified", async () => {
    mockHorizonCall.mockResolvedValue(
      makeHorizonResponse(makeHorizonPage(0, 5)),
    );

    renderHook(() => useTransactionHistory(PUBLIC_KEY));
    await flush();

    expect(mockOperations).toHaveBeenCalled();
  });

  // ── 9. Horizon server initialization ────────────────────────────────────

  it("defaults to the testnet Horizon URL", async () => {
    mockHorizonCall.mockResolvedValue(makeHorizonResponse([]));

    renderHook(() => useTransactionHistory(PUBLIC_KEY));
    await flush();

    expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
      "https://horizon-testnet.stellar.org",
    );
  });

  it("creates Horizon.Server with an explicit horizonUrl override", async () => {
    mockHorizonCall.mockResolvedValue(makeHorizonResponse([]));

    renderHook(() =>
      useTransactionHistory(PUBLIC_KEY, {
        horizonUrl: "https://horizon.stellar.org",
      }),
    );
    await flush();

    expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
      "https://horizon.stellar.org",
    );
  });
});
