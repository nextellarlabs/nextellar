/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSep24Interactive } from "../../src/templates/default/src/hooks/useSep24Interactive";

const SERVER = "https://anchor.example.com/sep24";
const ORIGIN = "https://anchor.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

function fakePopup() {
  return {
    closed: false,
    close: jest.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
}

const START = {
  transferServer: SERVER,
  kind: "withdraw" as const,
  authToken: "jwt",
  assetCode: "USDC",
  account: "GABC",
};

function interactiveFetch(txStatus?: string) {
  return jest.fn(async (url: string) => {
    if (String(url).includes("/interactive")) {
      return jsonResponse({
        type: "interactive_customer_info_needed",
        url: `${ORIGIN}/kyc?token=t`,
        id: "tx-1",
      });
    }
    return jsonResponse({
      transaction: { id: "tx-1", status: txStatus ?? "incomplete" },
    });
  });
}

function post(data: unknown, origin = ORIGIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin, data }));
  });
}

describe("useSep24Interactive (#1051)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("opens the interactive URL in a popup with callback=postMessage", async () => {
    const popup = fakePopup();
    const openWindow = jest.fn(() => popup as unknown as Window);
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow,
        pollIntervalMs: 0,
      }),
    );

    await act(async () => {
      await result.current.start(START);
    });

    expect(result.current.status).toBe("interactive");
    expect(result.current.transactionId).toBe("tx-1");
    const opened = new URL(openWindow.mock.calls[0][0]);
    expect(opened.origin).toBe(ORIGIN);
    expect(opened.searchParams.get("callback")).toBe("postMessage");
    expect(result.current.url).toBe(opened.toString());
  });

  it("moves to pending and closes the popup when the anchor posts pending_user_transfer_start", async () => {
    const popup = fakePopup();
    const onUpdate = jest.fn();
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow: () => popup as unknown as Window,
        pollIntervalMs: 0,
        onUpdate,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });

    post({
      transaction: {
        id: "tx-1",
        status: "pending_user_transfer_start",
        withdraw_anchor_account: "GANCHOR",
        withdraw_memo: "123",
      },
    });

    expect(result.current.status).toBe("pending");
    expect(result.current.transaction?.withdraw_anchor_account).toBe("GANCHOR");
    expect(popup.close).toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores messages from other origins or for other transactions", async () => {
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow: () => fakePopup() as unknown as Window,
        pollIntervalMs: 0,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });

    post(
      { transaction: { id: "tx-1", status: "completed" } },
      "https://evil.example",
    );
    post({ transaction: { id: "tx-other", status: "completed" } });

    expect(result.current.status).toBe("interactive");
    expect(result.current.transaction).toBeNull();
  });

  it.each([
    ["completed", "completed"],
    ["refunded", "completed"],
    ["error", "failed"],
    ["expired", "failed"],
  ])("maps terminal status %s to %s", async (txStatus, flowStatus) => {
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow: () => fakePopup() as unknown as Window,
        pollIntervalMs: 0,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });
    post({ transaction: { id: "tx-1", status: txStatus } });
    expect(result.current.status).toBe(flowStatus);

    // Later messages are ignored once the flow is finished.
    post({ transaction: { id: "tx-1", status: "pending_anchor" } });
    expect(result.current.status).toBe(flowStatus);
  });

  it("falls back to polling GET /transaction (redirect-style anchors)", async () => {
    jest.useFakeTimers();
    const fetchImpl = interactiveFetch("completed");
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl,
        openWindow: () => fakePopup() as unknown as Window,
        pollIntervalMs: 1000,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.status).toBe("completed"));
    expect(
      fetchImpl.mock.calls.some(([url]) =>
        String(url).includes("/transaction?id=tx-1"),
      ),
    ).toBe(true);
  });

  it("reports closed when the user closes the popup before finishing", async () => {
    jest.useFakeTimers();
    const popup = fakePopup();
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch("incomplete"),
        openWindow: () => popup as unknown as Window,
        pollIntervalMs: 1000,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });

    popup.closed = true;
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(result.current.status).toBe("closed"));
  });

  it("reports a blocked popup but still exposes the URL as a fallback", async () => {
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow: () => null,
        pollIntervalMs: 0,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/blocked/);
    expect(result.current.url).toContain("callback=postMessage");
  });

  it("does not open a popup in iframe mode", async () => {
    const openWindow = jest.fn();
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow,
        pollIntervalMs: 0,
      }),
    );
    await act(async () => {
      await result.current.start({ ...START, mode: "iframe" });
    });
    expect(openWindow).not.toHaveBeenCalled();
    expect(result.current.status).toBe("interactive");
  });

  it("surfaces anchor errors", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ error: "unsupported asset" }, 400));
    const { result } = renderHook(() =>
      useSep24Interactive({ fetchImpl, pollIntervalMs: 0 }),
    );
    await act(async () => {
      await result.current.start(START);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/unsupported asset/);
  });

  it("cancel closes the popup and reset returns to idle", async () => {
    const popup = fakePopup();
    const { result } = renderHook(() =>
      useSep24Interactive({
        fetchImpl: interactiveFetch(),
        openWindow: () => popup as unknown as Window,
        pollIntervalMs: 0,
      }),
    );
    await act(async () => {
      await result.current.start(START);
    });
    act(() => result.current.cancel());
    expect(popup.close).toHaveBeenCalled();
    expect(result.current.status).toBe("closed");

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.url).toBeNull();
  });
});
