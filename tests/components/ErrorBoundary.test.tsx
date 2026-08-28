/**
 * @jest-environment jsdom
 *
 * ErrorBoundary parity across every template (#817).
 *
 * ErrorBoundary was ported to all templates, but only the js-template .jsx
 * copy had a test proving it actually catches. These run the same render
 * against each template's own file, so a template whose boundary stops
 * rendering its fallback fails here — covering both the .tsx and .jsx
 * variants.
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

type ErrorBoundaryComponent = React.ComponentType<{
  children?: React.ReactNode;
}>;

/** Every template that ships an ErrorBoundary, with its source extension. */
const TEMPLATES: Array<{ name: string; ext: "tsx" | "jsx" }> = [
  { name: "default", ext: "tsx" },
  { name: "defi", ext: "tsx" },
  { name: "minimal", ext: "tsx" },
  { name: "js-template", ext: "jsx" },
  { name: "js-defi", ext: "jsx" },
];

const loaded = await Promise.all(
  TEMPLATES.map(async (template) => {
    const mod = await import(
      `../../src/templates/${template.name}/src/components/ErrorBoundary`
    );
    return {
      ...template,
      ErrorBoundary: mod.default as ErrorBoundaryComponent,
    };
  }),
);

function Boom(): React.ReactElement {
  throw new Error("boom");
}

describe.each(loaded)(
  "$name template ErrorBoundary (.$ext)",
  ({ ErrorBoundary }) => {
    let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      // React logs the caught error and its component stack on every boundary
      // hit; silence it so a passing run isn't drowned in expected noise.
      consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("renders its fallback when a child throws during render", () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Try Again" }),
      ).toBeInTheDocument();
    });

    it("renders children untouched when nothing throws", () => {
      render(
        <ErrorBoundary>
          <div>healthy child</div>
        </ErrorBoundary>,
      );

      expect(screen.getByText("healthy child")).toBeInTheDocument();
      expect(
        screen.queryByText("Something went wrong"),
      ).not.toBeInTheDocument();
    });

    it("reveals the error details on demand from the fallback", () => {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Show Details" }));

      expect(screen.getByText(/boom/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Hide Details" }),
      ).toBeInTheDocument();
    });
  },
);
