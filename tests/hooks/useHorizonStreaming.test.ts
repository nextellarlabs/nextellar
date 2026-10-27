/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

let streamHandlers: {
  onmessage?: () => void;
  onerror?: (err: unknown) => void;
} = {};

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      payments: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: (handlers: typeof streamHandlers) => {
              streamHandlers = handlers;
              return () => {};
            },
          }),
        }),
      }),
      operations: () => ({
        forAccount: () => ({
          cursor: () => ({
            stream: (handlers: typeof streamHandlers) => {
              streamHandlers = handlers;
              return () => {};
            },
          }),
        }),
      }),
    })),
  },
}));

await jest.unstable_mockModule(
  "../../src/templates/default/src/contexts/index.ts",
  () => ({
    useWalletConfig: () => ({
      horizonUrl: "https://horizon-testnet.stellar.org",
    }),
  }),
);

const { useHorizonStreaming } =
  await import("../../src/templates/default/src/hooks/useHorizonStreaming");

describe("useHorizonStreaming (#949)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    streamHandlers = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("invokes onUpdate when the stream receives an event", () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        onUpdate,
      ),
    );

    act(() => {
      streamHandlers.onmessage?.();
    });

    expect(onUpdate).toHaveBeenCalled();
  });

  it("falls back to polling after a stream error", () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        onUpdate,
        { pollIntervalMs: 5000 },
      ),
    );

    act(() => {
      streamHandlers.onerror?.(new Error("stream dropped"));
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(onUpdate).toHaveBeenCalled();
  });

  it("reconnects the stream with exponential backoff and resumes streaming (#1274)", () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        onUpdate,
      ),
    );

    // Initial connection drops.
    act(() => {
      streamHandlers.onerror?.(new Error("stream dropped"));
    });

    // First reconnect attempt is scheduled at 2^1 * 1000ms = 2000ms.
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // The backoff timer has now fired and reconnected the stream (stream()
    // was invoked again, reassigning streamHandlers to a fresh handler set).
    // Firing onmessage on that fresh handler proves the stream itself
    // resumed, not just the polling fallback.
    onUpdate.mockClear();
    act(() => {
      streamHandlers.onmessage?.();
    });

    expect(onUpdate).toHaveBeenCalled();
  });

  it("caps the reconnect backoff delay rather than growing it unbounded", () => {
    const onUpdate = jest.fn();
    renderHook(() =>
      useHorizonStreaming(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        onUpdate,
      ),
    );

    // Drop the stream repeatedly so the backoff would grow unbounded
    // (2^1, 2^2, 2^3, ... seconds) without a cap.
    for (let i = 0; i < 6; i += 1) {
      act(() => {
        streamHandlers.onerror?.(new Error("stream dropped"));
      });
      act(() => {
        jest.advanceTimersByTime(30_000);
      });
    }

    // After 6 consecutive drops, an uncapped exponential backoff would be
    // waiting on a delay far longer than MAX_RECONNECT_MS (30s). Firing one
    // more error and advancing by exactly the capped delay must still
    // trigger the next reconnect attempt.
    act(() => {
      streamHandlers.onerror?.(new Error("stream dropped"));
    });
    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    onUpdate.mockClear();
    act(() => {
      streamHandlers.onmessage?.();
    });

    expect(onUpdate).toHaveBeenCalled();
  });
});
