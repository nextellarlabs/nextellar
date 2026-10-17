/**
 * @jest-environment jsdom
 *
 * ThemeToggle toggle behavior and persisted theme (#1041).
 *
 * Rendered inside the real ThemeProvider against jsdom's real localStorage,
 * so these prove the full path: click -> provider state -> `.dark` on
 * `<html>` -> `nextellar_theme` in storage -> restored on the next mount.
 */
import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "../../src/templates/default/src/components/ThemeToggle";
import { ThemeProvider } from "../../src/templates/default/src/contexts/ThemeProvider";

const STORAGE_KEY = "nextellar_theme";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

const option = (name: "Light" | "Dark" | "System") =>
  screen.getByRole("radio", { name });

const htmlIsDark = () => document.documentElement.classList.contains("dark");

function expectChecked(name: "Light" | "Dark" | "System") {
  for (const other of ["Light", "Dark", "System"] as const) {
    expect(option(other)).toHaveAttribute(
      "aria-checked",
      String(other === name),
    );
  }
}

/** jsdom has no matchMedia; stub one reporting the given OS preference. */
function stubPrefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * A `matchMedia` stub that actually records its `change` listener(s), so a
 * test can simulate the OS preference flipping while the app is open by
 * calling the returned `fireChange` — the live-update path #1109 covers,
 * as opposed to `stubPrefersDark`'s fixed-at-mount-time value above.
 */
function stubPrefersDarkLive(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addEventListener: (
        _event: "change",
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _event: "change",
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  return {
    fireChange(nextMatches: boolean) {
      matches = nextMatches;
      const event = { matches: nextMatches } as MediaQueryListEvent;
      act(() => {
        listeners.forEach((listener) => listener(event));
      });
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("ThemeToggle", () => {
  describe("toggle behavior", () => {
    it("exposes a Theme radiogroup starting on System when nothing is persisted", () => {
      renderToggle();

      expect(
        screen.getByRole("radiogroup", { name: "Theme" }),
      ).toBeInTheDocument();
      expectChecked("System");
      expect(htmlIsDark()).toBe(false);
    });

    it("selecting Dark checks it and applies the dark theme", () => {
      renderToggle();

      fireEvent.click(option("Dark"));

      expectChecked("Dark");
      expect(htmlIsDark()).toBe(true);
    });

    it("selecting Light after Dark removes the dark theme", () => {
      renderToggle();

      fireEvent.click(option("Dark"));
      fireEvent.click(option("Light"));

      expectChecked("Light");
      expect(htmlIsDark()).toBe(false);
    });

    it("selecting System follows the OS color-scheme preference", () => {
      stubPrefersDark(true);
      renderToggle();

      fireEvent.click(option("Light"));
      expect(htmlIsDark()).toBe(false);

      fireEvent.click(option("System"));

      expectChecked("System");
      expect(htmlIsDark()).toBe(true);
    });
  });

  describe("live OS preference sync (#1109)", () => {
    it("updates the resolved theme when the OS preference changes while on System, without a manual toggle", () => {
      const stub = stubPrefersDarkLive(false);
      renderToggle();

      expectChecked("System");
      expect(htmlIsDark()).toBe(false);

      stub.fireChange(true);

      expect(htmlIsDark()).toBe(true);
      // Still "System" - a live OS change is not a manual choice.
      expectChecked("System");
    });

    it("flips back to light when the OS preference changes back, still on System", () => {
      const stub = stubPrefersDarkLive(true);
      renderToggle();

      expect(htmlIsDark()).toBe(true);

      stub.fireChange(false);

      expect(htmlIsDark()).toBe(false);
      expectChecked("System");
    });

    it("does not react to an OS preference change after the user made an explicit choice", () => {
      const stub = stubPrefersDarkLive(false);
      renderToggle();

      fireEvent.click(option("Light"));
      expect(htmlIsDark()).toBe(false);

      stub.fireChange(true);

      // A manual "Light" choice must not be overridden by a live OS change.
      expect(htmlIsDark()).toBe(false);
      expectChecked("Light");
    });

    it("registers exactly one change listener while on System, and removes it when switching away", () => {
      const stub = stubPrefersDarkLive(false);
      renderToggle();

      expect(stub.listenerCount()).toBe(1);

      fireEvent.click(option("Dark"));

      expect(stub.listenerCount()).toBe(0);
    });
  });

  describe("persisted theme", () => {
    it("persists each selection to localStorage", () => {
      renderToggle();

      fireEvent.click(option("Dark"));
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

      fireEvent.click(option("Light"));
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");

      fireEvent.click(option("System"));
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("system");
    });

    it("restores a persisted theme on mount", () => {
      window.localStorage.setItem(STORAGE_KEY, "dark");

      renderToggle();

      expectChecked("Dark");
      expect(htmlIsDark()).toBe(true);
    });

    it("a fresh mount picks up the theme chosen in a previous session", () => {
      const { unmount } = renderToggle();
      fireEvent.click(option("Dark"));
      unmount();
      document.documentElement.classList.remove("dark");

      renderToggle();

      expectChecked("Dark");
      expect(htmlIsDark()).toBe(true);
    });

    it("falls back to System when the persisted value is not a theme", () => {
      window.localStorage.setItem(STORAGE_KEY, "sepia");

      renderToggle();

      expectChecked("System");
      expect(htmlIsDark()).toBe(false);
    });
  });
});
