/**
 * @jest-environment jsdom
 *
 * Targets the js-template port of usePrefersReducedMotion (#1240, plain JS,
 * no types). jest.config.mjs compiles the js-* templates' .js modules to CJS
 * specifically so this file's hook module loads under Jest.
 */
import { renderHook, act } from "@testing-library/react";
import {
  readPrefersReducedMotion,
  usePrefersReducedMotion,
} from "../../src/templates/js-template/src/hooks/usePrefersReducedMotion.js";

describe("usePrefersReducedMotion (js-template, #1240)", () => {
  afterEach(() => {
    // @ts-expect-error restore jsdom's "no matchMedia" baseline between tests
    delete window.matchMedia;
  });

  function setMatchMedia(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: jest.fn((query: string) => ({
        matches,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
  }

  describe("readPrefersReducedMotion", () => {
    it("returns false when matchMedia is unavailable", () => {
      expect(readPrefersReducedMotion()).toBe(false);
    });

    it("returns true when the media query matches", () => {
      setMatchMedia(true);
      expect(readPrefersReducedMotion()).toBe(true);
    });

    it("returns false when the media query does not match", () => {
      setMatchMedia(false);
      expect(readPrefersReducedMotion()).toBe(false);
    });

    it("returns false (never throws) if matchMedia itself throws", () => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: jest.fn(() => {
          throw new Error("not supported");
        }),
      });
      expect(readPrefersReducedMotion()).toBe(false);
    });
  });

  describe("usePrefersReducedMotion", () => {
    it("starts false before mount settles, then reflects the real value after mount", () => {
      setMatchMedia(true);
      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current.prefersReducedMotion).toBe(true);
    });

    it("reflects false when the user has no reduced-motion preference", () => {
      setMatchMedia(false);
      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current.prefersReducedMotion).toBe(false);
    });

    it("refresh() re-checks the media query and returns the fresh value", () => {
      setMatchMedia(false);
      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current.prefersReducedMotion).toBe(false);

      // The OS setting changes while the page is open; this hook doesn't
      // subscribe to `change` events by design, so a caller must call
      // refresh() right before an animated action to pick it up.
      setMatchMedia(true);
      let refreshed: boolean = false;
      act(() => {
        refreshed = result.current.refresh();
      });
      expect(refreshed).toBe(true);
      expect(result.current.prefersReducedMotion).toBe(true);
    });

    it("does not subscribe to media query change events", () => {
      const addEventListener = jest.fn();
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: jest.fn((query: string) => ({
          matches: false,
          media: query,
          addEventListener,
          removeEventListener: jest.fn(),
        })),
      });
      renderHook(() => usePrefersReducedMotion());
      expect(addEventListener).not.toHaveBeenCalled();
    });
  });
});
