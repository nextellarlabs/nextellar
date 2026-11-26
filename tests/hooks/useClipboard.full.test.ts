/**
 * @jest-environment jsdom
 *
 * useClipboard — full template overlay (#1203)
 */
import { act, renderHook } from "@testing-library/react";
import { useClipboard } from "../../src/templates/full/src/hooks/useClipboard";
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useClipboard (full template, #1203)", () => {
  expectFullHookPort("useClipboard");

  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it("copies through the overlay hook and reports success", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { result } = renderHook(() => useClipboard());
    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copy("hello");
    });

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(copied).toBe(true);
    expect(result.current.copied).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces clipboard failures from the overlay hook", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("denied")),
      },
    });

    const { result } = renderHook(() => useClipboard());
    let copied: boolean | undefined;
    await act(async () => {
      copied = await result.current.copy("hello");
    });

    expect(copied).toBe(false);
    expect(result.current.error?.message).toBe("denied");
  });
});
