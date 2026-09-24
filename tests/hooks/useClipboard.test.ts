/**
 * @jest-environment jsdom
 *
 * Coverage for #842's new shared clipboard hook.
 */
import { renderHook, act } from "@testing-library/react";
import { useClipboard } from "../../src/templates/default/src/hooks/useClipboard";

describe("useClipboard", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it("starts with copied=false and no error", () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.copied).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets copied=true after a successful copy, and resets after the delay", async () => {
    const { result } = renderHook(() => useClipboard({ resetDelayMs: 2000 }));

    await act(async () => {
      await result.current.copy("hello");
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("returns true from copy() on success", async () => {
    const { result } = renderHook(() => useClipboard());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("hello");
    });
    expect(ok).toBe(true);
  });

  it("sets an error and returns false when the clipboard API rejects", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("denied")),
      },
    });
    const { result } = renderHook(() => useClipboard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("hello");
    });

    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(result.current.error?.message).toBe("denied");
  });

  it("sets an error and returns false when the Clipboard API is unavailable", async () => {
    Object.assign(navigator, { clipboard: undefined });
    const { result } = renderHook(() => useClipboard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("hello");
    });

    expect(ok).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("is a no-op for an empty string", async () => {
    const { result } = renderHook(() => useClipboard());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("");
    });
    expect(ok).toBe(false);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("clears a previous error on the next successful copy", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest
          .fn()
          .mockRejectedValueOnce(new Error("denied"))
          .mockResolvedValueOnce(undefined),
      },
    });
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy("first");
    });
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.copy("second");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.copied).toBe(true);
  });
});
