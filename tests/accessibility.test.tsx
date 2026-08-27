/**
 * @jest-environment jsdom
 *
 * Automated WCAG 2.1 AA regression coverage (#946) for template components
 * that render without heavy external dependencies. Runs axe-core (via
 * jest-axe) against real, rendered markup, plus targeted assertions for the
 * ARIA/keyboard behaviour axe can't check on its own (focus handling, live
 * regions carrying the right semantics, etc.).
 *
 * See docs/accessibility-audit.md for the full audit, including findings
 * that could only be verified manually or need a real browser.
 */
import React from "react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "@jest/globals";
import ErrorBoundary from "../src/templates/default/src/components/ErrorBoundary";
import ErrorBoundaryJs from "../src/templates/js-template/src/components/ErrorBoundary.jsx";
import WalletConnectButton from "../src/templates/default/src/components/WalletConnectButton";
import AccountSwitcher from "../src/templates/default/src/components/AccountSwitcher";
import {
  ACCOUNT_MAIN,
  ACCOUNT_SECOND,
  connectedWallet,
  disconnectedWallet,
  fireEvent,
  render,
  screen,
  silenceConsole,
} from "./helpers";

expect.extend(toHaveNoViolations);

function Boom(): never {
  throw new Error("boom");
}

const twoAccounts = connectedWallet({
  accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
  currentAccountIndex: 0,
  publicKey: ACCOUNT_MAIN.address,
});

describe("accessibility (#946)", () => {
  describe("ErrorBoundary fallback", () => {
    it("has no axe violations", async () => {
      const restoreConsole = silenceConsole();
      const { container } = render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      restoreConsole();
    });

    it("has no axe violations (JS template variant)", async () => {
      const restoreConsole = silenceConsole();
      const { container } = render(
        React.createElement(ErrorBoundaryJs, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      restoreConsole();
    });

    it("exposes the error details disclosure as an ARIA toggle", () => {
      const restoreConsole = silenceConsole();
      render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );

      const toggle = screen.getByRole("button", { name: "Show Details" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAttribute("aria-controls", "error-boundary-details");

      fireEvent.click(toggle);

      expect(
        screen.getByRole("button", { name: "Hide Details" }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        document.getElementById("error-boundary-details"),
      ).toBeInTheDocument();

      restoreConsole();
    });
  });

  describe("WalletConnectButton", () => {
    it("has no axe violations when disconnected", async () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: disconnectedWallet(),
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations when connected", async () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: connectedWallet(),
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("hides the decorative wallet icon from assistive tech", () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: disconnectedWallet(),
      });
      expect(container.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });
  });

  describe("AccountSwitcher", () => {
    it("has no axe violations closed", async () => {
      const { container } = render(React.createElement(AccountSwitcher), {
        wallet: twoAccounts,
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations open", async () => {
      const { container } = render(React.createElement(AccountSwitcher), {
        wallet: twoAccounts,
      });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));
      expect(await axe(container)).toHaveNoViolations();
    });

    it("exposes the trigger as a menu button reflecting open state", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      const trigger = screen.getByRole("button", { name: /Main Account/ });

      expect(trigger).toHaveAttribute("aria-haspopup", "true");
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("marks the active account with aria-current", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));

      const items = screen.getAllByRole("menuitem");
      expect(items[0]).toHaveAttribute("aria-current", "true");
      expect(items[1]).not.toHaveAttribute("aria-current");
    });

    it("closes on Escape", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
