/**
 * @jest-environment jsdom
 *
 * ThemeToggle respects prefers-reduced-motion (#1141).
 *
 * jsdom has no matchMedia, so each test installs a stub that answers the
 * reduced-motion query (and reports a light color scheme for everything
 * else), then asserts the theme-switch transition is dropped or kept.
 */
import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "../../src/templates/default/src/components/ThemeToggle";
import { ThemeProvider } from "../../src/templates/default/src/contexts/ThemeProvider";
import {
  REDUCED_MOTION_QUERY,
  readPrefersReducedMotion,
} from "../../src/templates/default/src/hooks/usePrefersReducedMotion";

/** Stub matchMedia; `reduce()` controls the reduced-motion answer live. */
function stubMatchMedia(initialReduce: boolean) {
  let reduce = initialReduce;
  const queries: string[] = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      queries.push(query);
      return {
        matches: query === REDUCED_MOTION_QUERY ? reduce : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
  return {
    set(next: boolean) {
      reduce = next;
    },
    queries,
  };
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

const option = (name: "Light" | "Dark" | "System") =>
  screen.getByRole("radio", { name });
const group = () => screen.getByRole("radiogroup", { name: "Theme" });

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("ThemeToggle prefers-reduced-motion (#1141)", () => {
  it("skips the color transition when prefers-reduced-motion: reduce is set", () => {
    stubMatchMedia(true);
    renderToggle();

    expect(group()).toHaveAttribute("data-reduced-motion", "true");
    for (const name of ["Light", "Dark", "System"] as const) {
      expect(option(name)).toHaveClass("transition-none");
      expect(option(name)).not.toHaveClass("transition-colors");
    }
  });

  it("keeps the transition (with a CSS motion-reduce fallback) when no preference is set", () => {
    stubMatchMedia(false);
    renderToggle();

    expect(group()).toHaveAttribute("data-reduced-motion", "false");
    expect(option("Dark")).toHaveClass("transition-colors", "motion-reduce:transition-none");
  });

  it("still switches the theme instantly with reduced motion", () => {
    stubMatchMedia(true);
    renderToggle();

    fireEvent.click(option("Dark"));

    expect(option("Dark")).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(option("Dark")).toHaveClass("transition-none");
  });

  it("picks up a preference changed while the page is open on the next switch", () => {
    const media = stubMatchMedia(false);
    renderToggle();
    expect(option("Light")).toHaveClass("transition-colors");

    media.set(true);
    act(() => {
      fireEvent.click(option("Dark"));
    });

    expect(group()).toHaveAttribute("data-reduced-motion", "true");
    expect(option("Light")).toHaveClass("transition-none");
  });

  it("queries the standard reduced-motion media feature", () => {
    const media = stubMatchMedia(true);
    renderToggle();

    expect(media.queries).toContain("(prefers-reduced-motion: reduce)");
  });

  it("falls back to animating when matchMedia is unavailable", () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    renderToggle();

    expect(group()).toHaveAttribute("data-reduced-motion", "false");
    expect(readPrefersReducedMotion()).toBe(false);
  });

  it("falls back to animating when matchMedia throws", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("unsupported");
      },
    });

    expect(readPrefersReducedMotion()).toBe(false);
  });
});
