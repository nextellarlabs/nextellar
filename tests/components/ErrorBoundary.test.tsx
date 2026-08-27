/**
 * @jest-environment jsdom
 */
import React from "react";
import ErrorBoundary from "../../src/templates/js-template/src/components/ErrorBoundary.jsx";
import { render, screen, silenceConsole } from "../helpers";

function Boom() {
  throw new Error("boom");
}

describe("ErrorBoundary template component", () => {
  it("renders a fallback when a child throws during render", () => {
    const restoreConsole = silenceConsole();

    render(React.createElement(ErrorBoundary, null, React.createElement(Boom)));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try Again" }),
    ).toBeInTheDocument();

    restoreConsole();
  });
});
