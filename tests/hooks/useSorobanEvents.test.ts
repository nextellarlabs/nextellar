/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';

// Import the shared SDK mock – gives us control over rpc.Server.getEvents()
import { mockGetEvents, mockServerConstructor } from '../../src/mocks/stellar-sdk-mock.js';

// Import the REAL hook – its '@stellar/stellar-sdk' dependency is resolved to
// the shared mock above via jest.config moduleNameMapper.
import { useSorobanEvents } from '../../src/templates/default/src/hooks/useSorobanEvents.js';

// ── Types (declared locally to avoid circular import issues) ─────────────────

interface SorobanEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: unknown;
  pagingToken: string;
  txHash: string;
  inSuccessfulContractCall: boolean;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CONTRACT_ID = 'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345';

/**
 * Build a mock SDK EventResponse matching the shape of rpc.Api.EventResponse.
 * The real SDK returns objects with toXDR() on topic/value and toString() on
 * contractId – we replicate that interface here.
 */
function makeSdkEvent(overrides: Record<string, any> = {}) {
  const {
    id = 'evt-001',
    type = 'contract',
    ledger = 100,
    ledgerClosedAt = '2024-01-01T00:00:00Z',
    contractId = CONTRACT_ID,
    topic = ['AAAADgAAAAh0cmFuc2Zlcg=='],
    value = 'AAAAAQAAAA==',
    pagingToken = 'cursor-001',
    txHash = 'abc123def456',
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
    pagingToken,
    txHash,
    inSuccessfulContractCall,
  };
}

// Pre-built SDK-shaped mock events
const sdkEvent1 = makeSdkEvent({ id: 'evt-001', pagingToken: 'cursor-001', ledger: 100 });
const sdkEvent2 = makeSdkEvent({ id: 'evt-002', pagingToken: 'cursor-002', ledger: 101 });
const sdkEvent3 = makeSdkEvent({ id: 'evt-003', pagingToken: 'cursor-003', ledger: 102 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSorobanEvents (Template Hook)', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  /** Flush microtasks so async state updates from the hook are applied. */
  async function flush() {
    await act(async () => {});
  }

  /** Advance fake timers by `ms` and flush resulting microtasks. */
  async function advanceAndFlush(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await flush();
  }

  /**
   * Fire all pending timers repeatedly to exhaust retry back-offs.
   * Each iteration fires pending timeouts and flushes resulting microtasks.
   */
  async function exhaustRetries() {
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
    }
  }

  // ── Return shape ──────────────────────────────────────────────────────────

  it('should return the correct public API shape', async () => {
    mockGetEvents.mockResolvedValue({ events: [], latestLedger: 0 });

    const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
    await flush();

    expect(Array.isArray(result.current.events)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.stopPolling).toBe('function');
    expect(result.current.error).toBeNull();
    expect(typeof result.current.isRecovering).toBe('boolean');
  });

  // ── Successful polling with cursor tracking ───────────────────────────────

  describe('successful event polling with cursor tracking', () => {
    it('should return events from the initial fetch', async () => {
      mockGetEvents.mockResolvedValue({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      expect(result.current.events).toHaveLength(2);
      expect(result.current.events[0].id).toBe('evt-001');
      expect(result.current.events[1].id).toBe('evt-002');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should track cursor via the last event pagingToken', async () => {
      mockGetEvents.mockResolvedValue({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-002');
    });

    it('should accumulate events across multiple polls', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();
      expect(result.current.events).toHaveLength(2);

      // Second poll returns a new event
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent3],
        latestLedger: 102,
      });

      await advanceAndFlush(10_000);

      expect(result.current.events).toHaveLength(3);
      expect(result.current.events[2].id).toBe('evt-003');
    });

    it('should set loading to true while fetching', async () => {
      let resolveGetEvents!: (value: any) => void;
      mockGetEvents.mockImplementation(
        () => new Promise((resolve) => { resolveGetEvents = resolve; })
      );

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      // Flush so useEffect fires and refresh() sets loading = true
      await act(async () => { await Promise.resolve(); });

      expect(result.current.loading).toBe(true);

      // Resolve the pending fetch
      await act(async () => {
        resolveGetEvents({ events: [], latestLedger: 0 });
      });
      await flush();

      expect(result.current.loading).toBe(false);
    });
  });

  // ── Event deduplication ───────────────────────────────────────────────────

  describe('event deduplication by ID', () => {
    it('should not include duplicate events across polls', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      // Second poll returns evt-002 again (duplicate) plus evt-003
      const duplicateEvt2 = makeSdkEvent({ id: 'evt-002', pagingToken: 'cursor-002', ledger: 101 });
      mockGetEvents.mockResolvedValueOnce({
        events: [duplicateEvt2, sdkEvent3],
        latestLedger: 102,
      });

      await advanceAndFlush(10_000);

      const ids = result.current.events.map((e: SorobanEvent) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(['evt-001', 'evt-002', 'evt-003']);
    });

    it('should keep only the first occurrence when duplicates arrive in subsequent polls', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1],
        latestLedger: 100,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();
      expect(result.current.events).toHaveLength(1);

      // Return the same event in the next poll
      mockGetEvents.mockResolvedValueOnce({
        events: [makeSdkEvent({ id: 'evt-001', pagingToken: 'cursor-001' })],
        latestLedger: 100,
      });

      await advanceAndFlush(10_000);

      // Still only one event – deduplication prevented the duplicate
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].pagingToken).toBe('cursor-001');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling when RPC returns an error', () => {
    it('should surface the error after retries are exhausted', async () => {
      const rpcError = new Error('getEvents failed: 503 Service Unavailable');
      mockGetEvents.mockRejectedValue(rpcError);

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await exhaustRetries();

      expect(result.current.error).toBeTruthy();
      expect(result.current.error?.message).toBe('getEvents failed: 503 Service Unavailable');
    });

    it('should set isRecovering to true in error-recovery mode', async () => {
      mockGetEvents.mockRejectedValue(new Error('Transient failure'));

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await exhaustRetries();

      expect(result.current.isRecovering).toBe(true);
    });

    it('should clear error and recovery state on successful fetch', async () => {
      // Start with failures to enter error-recovery mode
      mockGetEvents.mockRejectedValue(new Error('Temporary failure'));

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await exhaustRetries();

      expect(result.current.error).toBeTruthy();
      expect(result.current.isRecovering).toBe(true);

      // Now succeed on the next poll
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      // Error mode polls at 2× interval (20 s) – advance past it
      await advanceAndFlush(20_000);
      await exhaustRetries();

      expect(result.current.error).toBeNull();
      expect(result.current.isRecovering).toBe(false);
      expect(result.current.events).toHaveLength(1);
    });

    it('should preserve previously fetched events when an error occurs', async () => {
      // First fetch succeeds
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();
      expect(result.current.events).toHaveLength(2);

      // Subsequent polls fail
      mockGetEvents.mockRejectedValue(new Error('Network timeout'));
      await advanceAndFlush(10_000);
      await exhaustRetries();

      // Events from the successful fetch should still be present
      expect(result.current.events).toHaveLength(2);
      expect(result.current.error).toBeTruthy();
    });
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  describe('cleanup on unmount', () => {
    it('should stop polling when component unmounts', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      const { unmount } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      unmount();

      // After unmount, further timer ticks should not trigger more getEvents calls
      const callCount = mockGetEvents.mock.calls.length;
      jest.advanceTimersByTime(30_000);
      expect(mockGetEvents.mock.calls.length).toBe(callCount);
    });

    it('should not throw when unmounting', async () => {
      mockGetEvents.mockResolvedValue({ events: [], latestLedger: 0 });

      const { unmount } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      expect(() => unmount()).not.toThrow();
    });
  });

  // ── Cursor advances after each successful poll ────────────────────────────

  describe('cursor advances after each successful poll', () => {
    it('should advance cursor to the last event pagingToken', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1, sdkEvent2],
        latestLedger: 101,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      let lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-002');

      // Next poll returns a new event
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent3],
        latestLedger: 102,
      });

      await advanceAndFlush(10_000);

      lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent.pagingToken).toBe('cursor-003');
    });

    it('should pass the cursor to subsequent getEvents calls', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1],
        latestLedger: 100,
      });

      renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      // First call should not include a cursor
      expect(mockGetEvents.mock.calls[0][0]).not.toHaveProperty('cursor');

      // Set up next poll
      mockGetEvents.mockResolvedValueOnce({ events: [], latestLedger: 100 });

      await advanceAndFlush(10_000);

      // Second call should pass the cursor from the first event
      expect(mockGetEvents.mock.calls[1][0].cursor).toBe('cursor-001');
    });

    it('should not advance cursor when no new events are returned', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [sdkEvent1],
        latestLedger: 100,
      });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();
      expect(result.current.events[0].pagingToken).toBe('cursor-001');

      // Next poll returns no events
      mockGetEvents.mockResolvedValueOnce({ events: [], latestLedger: 100 });

      await advanceAndFlush(10_000);

      // Events unchanged
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].pagingToken).toBe('cursor-001');
    });
  });

  // ── Manual refresh ────────────────────────────────────────────────────────

  describe('manual refresh', () => {
    it('should trigger a new fetch when refresh is called', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      const callsBefore = mockGetEvents.mock.calls.length;

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetEvents.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // ── Event structure validation ────────────────────────────────────────────

  describe('event structure', () => {
    it('should map SDK events to the correct SorobanEvent shape', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      const event = result.current.events[0];
      expect(event).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          type: expect.any(String),
          ledger: expect.any(Number),
          ledgerClosedAt: expect.any(String),
          contractId: expect.any(String),
          topic: expect.any(Array),
          pagingToken: expect.any(String),
          txHash: expect.any(String),
          inSuccessfulContractCall: expect.any(Boolean),
        })
      );
    });

    it('should have topic as an array of strings', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      const event = result.current.events[0];
      expect(Array.isArray(event.topic)).toBe(true);
      event.topic.forEach((t: string) => {
        expect(typeof t).toBe('string');
      });
    });

    it('should map contractId to a string via toString()', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      const { result } = renderHook(() => useSorobanEvents(CONTRACT_ID));
      await flush();

      expect(result.current.events[0].contractId).toBe(CONTRACT_ID);
    });
  });

  // ── Options / configuration ───────────────────────────────────────────────

  describe('configuration options', () => {
    it('should use custom sorobanRpc URL when provided', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      renderHook(() =>
        useSorobanEvents(CONTRACT_ID, {
          sorobanRpc: 'https://custom-rpc.example.com',
        })
      );
      await flush();

      // Verify the RPC Server was created with the custom URL
      expect(mockServerConstructor).toHaveBeenCalledWith('https://custom-rpc.example.com');
    });

    it('should use fromCursor as the starting cursor', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent2], latestLedger: 101 });

      renderHook(() =>
        useSorobanEvents(CONTRACT_ID, { fromCursor: 'cursor-001' })
      );
      await flush();

      // The first getEvents call should include the cursor
      expect(mockGetEvents.mock.calls[0][0].cursor).toBe('cursor-001');
    });

    it('should pass topic filters to getEvents', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });
      const topicFilter = [['AAAADgAAAAh0cmFuc2Zlcg==']];

      renderHook(() =>
        useSorobanEvents(CONTRACT_ID, { topics: topicFilter })
      );
      await flush();

      expect(mockGetEvents.mock.calls[0][0].filters[0].topics).toEqual(topicFilter);
    });

    it('should not poll when pollIntervalMs is null', async () => {
      mockGetEvents.mockResolvedValue({ events: [sdkEvent1], latestLedger: 100 });

      renderHook(() =>
        useSorobanEvents(CONTRACT_ID, { pollIntervalMs: null })
      );
      await flush();

      const callsAfterInit = mockGetEvents.mock.calls.length;

      // Advance well past the default poll interval
      jest.advanceTimersByTime(30_000);
      await flush();

      // No additional calls should have been made
      expect(mockGetEvents.mock.calls.length).toBe(callsAfterInit);
    });
  });
});
