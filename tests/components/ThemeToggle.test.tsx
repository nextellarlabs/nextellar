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
import { fireEvent, render, screen } from "@testing-library/react";
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
