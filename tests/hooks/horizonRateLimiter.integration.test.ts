/**
 * @jest-environment jsdom
 *
 * Rate-limit integration test between `useHorizonStreaming` (Horizon SSE) and
 * the polling hooks (#1289).
 *
 * Both hook types spend from one shared client-side budget
 * (`globalHorizonRateLimiter`). This suite drives them concurrently against
 * the same account and asserts that:
 *
 *  1. every Horizon request is counted exactly once — no double counting,
 *  2. a burst of live stream events cannot starve the polling loop,
 *  3. a busy polling loop cannot starve the live stream,
 *  4. once the shared budget is exhausted both sides are blocked and no
 *     request is sent to Horizon,
 *  5. a HTTP 429 puts both sides into the same cooldown, and
 *  6. the budget recovers once the window rolls over.
 *
 * The hooks under test are the real ones from the default template; only the
 * Stellar SDK is mocked, so no request ever leaves the machine.
 */
import { jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import {
  advanceAndFlush,
  flush,
  withFakeHookTimers,
} from "../helpers/fake-timers";
import { silenceConsole } from "../helpers/console";

type StreamHandlers = {
  onmessage?: () => void;
  onerror?: (err: unknown) => void;
};

/** Handlers of every live Horizon stream opened by the hooks. */
const openStreams: StreamHandlers[] = [];

/** Every Horizon account request made by the hooks under test. */
const mockAccountCall = jest.fn();

/** Opens an SSE stream and hands its handlers to the test. */
const mockStream = jest.fn((handlers: StreamHandlers) => {
  openStreams.push(handlers);
  return () => {};
});

function makeStreamBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.forAccount = jest.fn(chain);
  builder.order = jest.fn(chain);
  builder.limit = jest.fn(chain);
  builder.cursor = jest.fn(chain);
  builder.call = mockAccountCall;
  builder.stream = mockStream;
  return builder;
}

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({ accountId: () => ({ call: mockAccountCall }) }),
      payments: () => makeStreamBuilder(),
      operations: () => makeStreamBuilder(),
    })),
  },
}));

const { useHorizonStreaming } =
  await import("../../src/templates/default/src/hooks/useHorizonStreaming");
const { useStellarBalances } =
  await import("../../src/templates/default/src/hooks/useStellarBalances");
const { globalHorizonRateLimiter } =
  await import("../../src/templates/default/src/lib/horizonRateLimiter");

const ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const POLL_INTERVAL_MS = 5_000;

/** Budget of the shared limiter: 30 requests per 10s window. */
const MAX_REQUESTS = globalHorizonRateLimiter.getMaxRequestsPerWindow();
/** Slots the shared limiter holds back for the *other* traffic class. */
const RESERVED = globalHorizonRateLimiter.getReservedRequestsPerClass();
/** Requests one class may spend while the other class is active. */
const CLASS_LIMIT = MAX_REQUESTS - RESERVED;

/** Flushes enough microtask ticks for a full request cycle to settle. */
async function settle(): Promise<void> {
  await flush();
  await flush();
}

/** Advances the fake clock and lets the triggered request settle. */
async function advanceAndSettle(ms: number): Promise<void> {
  await advanceAndFlush(ms);
  await flush();
}

/** Delivers a live Horizon event to every open stream. */
async function fireStreamEvent(): Promise<void> {
  await act(async () => {
    for (const handlers of openStreams) {
      handlers.onmessage?.();
    }
  });
  await settle();
}

/**
 * Spends up to `count` slots of the polling side of the shared budget and
 * reports how many actually went through.
 *
 * The polling hook itself can only fire every five seconds, so a window
 * never holds more than a couple of polls. This helper stands in for "the
 * polling side is busy" when the test needs the polling class saturated, and
 * it also proves that the polling side cannot take more than its share of
 * the window.
 */
async function trySpendPollBudget(count: number): Promise<number> {
  let spent = 0;
  for (let i = 0; i < count; i++) {
    try {
      await globalHorizonRateLimiter.execute(() => Promise.resolve(), "poll");
      spent += 1;
    } catch {
      // The shared guard blocked this request — that is the behaviour under
      // test, not a failure of the helper.
    }
  }
  return spent;
}

describe("Horizon rate limiting — streaming hook vs polling hooks (#1289)", () => {
  withFakeHookTimers();

  let restoreConsole: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    restoreConsole = silenceConsole(["error", "warn"]);
    openStreams.length = 0;
    globalHorizonRateLimiter.reset();
    mockAccountCall.mockReset();
    mockAccountCall.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });
  });

  afterEach(() => {
    restoreConsole();
  });

  it("shares one budget between the live stream and the polling loop", async () => {
    const { result } = renderHookWithStreamAndPolling();
    await settle();

    // The initial load is a scheduled request: it is charged to `poll`.
    expect(mockAccountCall).toHaveBeenCalledTimes(1);
    expect(globalHorizonRateLimiter.getRequestCount("poll")).toBe(1);
    expect(globalHorizonRateLimiter.getRequestCount("stream")).toBe(0);

    // A live Horizon event drives a refresh: it is charged to `stream`.
    await fireStreamEvent();

    expect(mockAccountCall).toHaveBeenCalledTimes(2);
    expect(globalHorizonRateLimiter.getRequestCount("stream")).toBe(1);
    expect(globalHorizonRateLimiter.getRequestCount("poll")).toBe(1);

    // A poll tick drives a refresh: it is charged to `poll`.
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(mockAccountCall).toHaveBeenCalledTimes(3);
    expect(globalHorizonRateLimiter.getRequestCount("poll")).toBe(2);
    expect(globalHorizonRateLimiter.getRequestCount("stream")).toBe(1);

    // Every request is counted exactly once — the shared budget is not
    // charged twice for the same Horizon call, and opening an SSE stream
    // does not spend a JSON API slot.
    expect(globalHorizonRateLimiter.getRequestCount()).toBe(
      mockAccountCall.mock.calls.length,
    );
    expect(globalHorizonRateLimiter.getRequestCount()).toBe(
      globalHorizonRateLimiter.getRequestCount("poll") +
        globalHorizonRateLimiter.getRequestCount("stream"),
    );

    expect(result.current.state.balances).toHaveLength(1);
    expect(result.current.state.error).toBeNull();
  });

  it("does not let a burst of live events starve the polling loop", async () => {
    const { result } = renderHookWithStreamAndPolling();
    await settle();

    // Saturate the `stream` class: it may spend CLASS_LIMIT requests while
    // the poller is active. The extra events are blocked by the guard.
    for (let i = 0; i < CLASS_LIMIT + 5; i++) {
      await fireStreamEvent();
    }

    expect(globalHorizonRateLimiter.getRequestCount("stream")).toBe(
      CLASS_LIMIT,
    );

    const callsBeforePoll = mockAccountCall.mock.calls.length;

    // The poller still gets through: the stream burst did not eat the slots
    // reserved for it.
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(mockAccountCall.mock.calls.length).toBe(callsBeforePoll + 1);
    expect(globalHorizonRateLimiter.getRequestCount("poll")).toBe(2);

    // A locally throttled request is not a Horizon failure: the hook keeps
    // the balances it has and surfaces no error.
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.balances).toHaveLength(1);
  });

  it("does not let a busy polling loop starve the live stream", async () => {
    const { result } = renderHookWithStreamAndPolling();
    await settle();

    // One live event first, so both traffic classes are active and the
    // per-class reservation applies.
    await fireStreamEvent();

    // The polling side spends its share of the window…
    const spent = await trySpendPollBudget(CLASS_LIMIT + 5);

    // …and cannot take more than that, however hard it keeps asking.
    expect(spent).toBe(CLASS_LIMIT - 1);
    expect(globalHorizonRateLimiter.getRequestCount("poll")).toBe(CLASS_LIMIT);

    const callsBeforeStream = mockAccountCall.mock.calls.length;

    // The live stream still gets its reserved share of the window, even
    // though the polling side has taken everything it is allowed to.
    for (let i = 0; i < RESERVED - 1; i++) {
      await fireStreamEvent();
    }

    expect(mockAccountCall.mock.calls.length).toBe(
      callsBeforeStream + RESERVED - 1,
    );
    expect(globalHorizonRateLimiter.getRequestCount("stream")).toBe(RESERVED);
    expect(globalHorizonRateLimiter.getRequestCount()).toBe(MAX_REQUESTS);
    expect(result.current.state.error).toBeNull();
  });

  it("blocks both sides once the shared budget is exhausted", async () => {
    const { result } = renderHookWithStreamAndPolling();
    await settle();

    // Fill the whole window: the stream class takes CLASS_LIMIT slots, the
    // polling side takes the rest.
    for (let i = 0; i < CLASS_LIMIT; i++) {
      await fireStreamEvent();
    }
    await trySpendPollBudget(MAX_REQUESTS - CLASS_LIMIT - 1);

    expect(globalHorizonRateLimiter.getRequestCount()).toBe(MAX_REQUESTS);
    const callsWhenExhausted = mockAccountCall.mock.calls.length;

    // Both sides are now blocked: no further request is sent to Horizon.
    await fireStreamEvent();
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(mockAccountCall.mock.calls.length).toBe(callsWhenExhausted);
    expect(globalHorizonRateLimiter.isRateLimited("stream")).toBe(true);
    expect(globalHorizonRateLimiter.isRateLimited("poll")).toBe(true);

    // The guard is a local throttle, not a Horizon failure.
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.balances).toHaveLength(1);
  });

  it("puts both sides into the same cooldown after a HTTP 429", async () => {
    renderHookWithStreamAndPolling();
    await settle();

    mockAccountCall.mockRejectedValueOnce(
      Object.assign(new Error("Too Many Requests"), { status: 429 }),
    );

    await advanceAndSettle(POLL_INTERVAL_MS);

    // The 429 triggered a cooldown that both traffic classes respect.
    expect(globalHorizonRateLimiter.getRemainingCooldownMs()).toBeGreaterThan(
      0,
    );
    expect(globalHorizonRateLimiter.isRateLimited("stream")).toBe(true);
    expect(globalHorizonRateLimiter.isRateLimited("poll")).toBe(true);

    const callsDuringCooldown = mockAccountCall.mock.calls.length;

    // No request is sent while the cooldown is active — neither from the
    // poller nor from the live stream.
    await advanceAndSettle(1_000);
    await fireStreamEvent();

    expect(mockAccountCall.mock.calls.length).toBe(callsDuringCooldown);
  });

  it("recovers once the cooldown and the window have rolled over", async () => {
    renderHookWithStreamAndPolling();
    await settle();

    mockAccountCall.mockRejectedValueOnce(
      Object.assign(new Error("Too Many Requests"), { status: 429 }),
    );
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(globalHorizonRateLimiter.getRemainingCooldownMs()).toBeGreaterThan(
      0,
    );

    // Past the cooldown (5s) and the window (10s): the budget is available
    // again for both classes.
    await advanceAndSettle(30_000);

    expect(globalHorizonRateLimiter.getRemainingCooldownMs()).toBe(0);
    expect(globalHorizonRateLimiter.isRateLimited("stream")).toBe(false);
    expect(globalHorizonRateLimiter.isRateLimited("poll")).toBe(false);

    const callsBefore = mockAccountCall.mock.calls.length;
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(mockAccountCall.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("tags live events and poll fallbacks with their traffic class", async () => {
    const onUpdate = jest.fn();

    renderHook(() =>
      useHorizonStreaming(ADDRESS, onUpdate, {
        enabled: true,
        pollIntervalMs: POLL_INTERVAL_MS,
      }),
    );
    await settle();

    // A live Horizon event is a `stream` update.
    await act(async () => {
      for (const handlers of openStreams) {
        handlers.onmessage?.();
      }
    });
    expect(onUpdate).toHaveBeenCalledWith("stream");

    // When the stream drops, the hook falls back to polling: those updates
    // are `poll` updates, so they are charged to the polling budget.
    await act(async () => {
      for (const handlers of openStreams) {
        handlers.onerror?.(new Error("stream dropped"));
      }
    });
    await advanceAndSettle(POLL_INTERVAL_MS);

    expect(onUpdate).toHaveBeenCalledWith("poll");
  });
});

/**
 * Renders the streaming hook and the polling hook side by side for the same
 * account — the situation #1289 describes.
 *
 * `useStellarBalances` owns a stream of its own (`enableStreaming`), so the
 * live events it receives are charged to the `stream` traffic class, while
 * its poll ticks are charged to `poll`. The standalone `useHorizonStreaming`
 * is the second concurrent stream of the same account.
 */
function renderHookWithStreamAndPolling() {
  return renderHook(() => {
    const state = useStellarBalances(ADDRESS, {
      pollIntervalMs: POLL_INTERVAL_MS,
      enableStreaming: true,
    });
    const streaming = useHorizonStreaming(ADDRESS, () => {}, {
      enabled: true,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
    return { state, streaming };
  });
}
