/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";

await jest.unstable_mockModule(
  "@stellar/stellar-sdk",
  async () => await import("../../src/mocks/stellar-sdk-mock.js"),
);

// Import the shared SDK mock – gives us control over rpc.Server.getEvents()
const { mockGetEvents } = await import("../../src/mocks/stellar-sdk-mock.js");

// Import the REAL hook – its '@stellar/stellar-sdk' dependency is resolved to
// the shared mock above via jest.config moduleNameMapper.
const { useContractEventHistory } =
  await import("../../src/templates/defi/src/hooks/useContractEventHistory.js");

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CONTRACT_ID = "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345";

/**
 * Build a mock SDK EventResponse matching the shape of rpc.Api.EventResponse.
 * The real SDK returns objects with toXDR() on topic/value and toString() on
 * contractId – we replicate that interface here.
 */
function makeSdkEvent(overrides: Record<string, any> = {}) {
  const {
    id = "evt-001",
    type = "contract",
    ledger = 100,
    ledgerClosedAt = "2024-01-01T00:00:00Z",
    contractId = CONTRACT_ID,
    topic = ["AAAADgAAAAh0cmFuc2Zlcg=="],
    value = "AAAAAQAAAA==",
    txHash = "abc123def456",
    inSuccessfulContractCall = true,
  } = overrides;

  return {
    id,
    type,
    ledger,
    ledgerClosedAt,
    contractId: { toString: () => contractId },
    topic: (topic as string[]).map((t: string) => ({ toXDR: () => t })),
    value: { toXDR: () => value },
    txHash,
    inSuccessfulContractCall,
  };
}

function makePage(count: number, startId = 1, startLedger = 100) {
  return Array.from({ length: count }, (_, i) =>
    makeSdkEvent({
      id: `evt-${String(startId + i).padStart(3, "0")}`,
      ledger: startLedger + i,
    }),
  );
}

describe("useContractEventHistory (Defi Template Hook)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the correct public API shape", () => {
    const { result } = renderHook(() => useContractEventHistory(CONTRACT_ID));

    expect(Array.isArray(result.current.events)).toBe(true);
    expect(result.current.events).toHaveLength(0);
    expect(typeof result.current.loading).toBe("boolean");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.isDone).toBe("boolean");
    expect(result.current.isDone).toBe(false);
    expect(typeof result.current.fetchNextPage).toBe("function");
    expect(typeof result.current.reset).toBe("function");
  });

  it("should fetch a page of historical events starting from startLedger", async () => {
    mockGetEvents.mockResolvedValue({
      events: makePage(2),
      latestLedger: 200,
    });

    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { startLedger: 500, limit: 50 }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(mockGetEvents.mock.calls[0][0]).toMatchObject({
      startLedger: 500,
      limit: 50,
    });
    expect(mockGetEvents.mock.calls[0][0]).not.toHaveProperty("cursor");
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe("evt-001");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should paginate using the response cursor across successive calls", async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: makePage(2, 1),
      latestLedger: 101,
      cursor: "cursor-page-1",
    });

    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { limit: 2 }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.events).toHaveLength(2);
    expect(mockGetEvents.mock.calls[0][0]).not.toHaveProperty("cursor");

    mockGetEvents.mockResolvedValueOnce({
      events: makePage(1, 3),
      latestLedger: 102,
      cursor: "cursor-page-2",
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockGetEvents.mock.calls[1][0].cursor).toBe("cursor-page-1");
    expect(result.current.events).toHaveLength(3);
    expect(result.current.events.map((e: any) => e.id)).toEqual([
      "evt-001",
      "evt-002",
      "evt-003",
    ]);
  });

  it("should deduplicate events by id across pages", async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: makePage(2, 1),
      latestLedger: 101,
      cursor: "cursor-page-1",
    });

    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { limit: 2 }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    mockGetEvents.mockResolvedValueOnce({
      events: [...makePage(1, 2), ...makePage(1, 3)],
      latestLedger: 102,
      cursor: "cursor-page-2",
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.events).toHaveLength(3);
    expect(result.current.events.map((e: any) => e.id)).toEqual([
      "evt-001",
      "evt-002",
      "evt-003",
    ]);
  });

  it("should no-op fetchNextPage once isDone is true", async () => {
    mockGetEvents.mockResolvedValue({ events: makePage(1), latestLedger: 100 });

    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { limit: 10 }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(result.current.isDone).toBe(true);
    expect(mockGetEvents).toHaveBeenCalledTimes(1);

    const secondCallResult = await act(async () => {
      return result.current.fetchNextPage();
    });

    expect(secondCallResult).toBeUndefined();
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
  });

  it("should set loading true while a fetch is in flight", async () => {
    let resolveGetEvents!: (value: any) => void;
    mockGetEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGetEvents = resolve;
        }),
    );

    const { result } = renderHook(() => useContractEventHistory(CONTRACT_ID));

    let pagePromise!: Promise<unknown>;
    act(() => {
      pagePromise = result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveGetEvents({ events: [], latestLedger: 0 });
      await pagePromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it("should surface RPC errors via the error field and rethrow", async () => {
    const rpcError = new Error("RPC unavailable");
    mockGetEvents.mockRejectedValue(rpcError);

    const { result } = renderHook(() => useContractEventHistory(CONTRACT_ID));

    await act(async () => {
      await expect(result.current.fetchNextPage()).rejects.toThrow(
        "RPC unavailable",
      );
    });

    expect(result.current.error).toBe(rpcError);
    expect(result.current.loading).toBe(false);
  });

  it("should pass topic filters through to the RPC request", async () => {
    mockGetEvents.mockResolvedValue({ events: [], latestLedger: 0 });

    const topics = [["AAAADgAAAAh0cmFuc2Zlcg=="]];
    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { topics }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockGetEvents.mock.calls[0][0].filters[0]).toMatchObject({
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics,
    });
  });

  it("should clear events, error, and cursor state on reset()", async () => {
    mockGetEvents.mockResolvedValueOnce({
      events: makePage(1),
      latestLedger: 100,
      cursor: "cursor-1",
    });

    const { result } = renderHook(() =>
      useContractEventHistory(CONTRACT_ID, { limit: 10 }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.isDone).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.events).toHaveLength(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isDone).toBe(false);
    expect(result.current.loading).toBe(false);

    mockGetEvents.mockResolvedValueOnce({ events: [], latestLedger: 0 });
    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockGetEvents.mock.calls[1][0]).not.toHaveProperty("cursor");
  });
});
