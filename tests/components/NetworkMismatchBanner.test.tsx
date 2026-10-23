/**
 * @jest-environment jsdom
 *
 * NetworkMismatchBanner component tests (#1072, #1277).
 *
 * Covers:
 * - Hidden when disconnected
 * - Hidden when connected and networks agree
 * - Hidden when the wallet's network is unknown (not a mismatch)
 * - Shown, with role="alert", when connected and networks disagree
 * - Dismissible, and reappears on a further/different mismatch (#1277)
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

const [{ NetworkMismatchBanner }, { useWallet }] = await Promise.all([
  import("../../src/templates/default/src/components/NetworkMismatchBanner"),
  import("../../src/mocks/wallet-contexts-mock"),
]);

function mockWallet(overrides: Record<string, unknown> = {}) {
  (useWallet as jest.Mock).mockReturnValue({
    connected: false,
    networkMismatch: false,
    walletNetworkPassphrase: undefined,
    ...overrides,
  });
}

describe("NetworkMismatchBanner", () => {
  it("renders nothing when disconnected", () => {
    mockWallet({ connected: false, networkMismatch: false });
    const { container } = render(<NetworkMismatchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when connected and the networks agree", () => {
    mockWallet({
      connected: true,
      networkMismatch: false,
      walletNetworkPassphrase: "Test SDF Network ; September 2015",
    });
    const { container } = render(<NetworkMismatchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the wallet's network is unknown", () => {
    mockWallet({
      connected: true,
      networkMismatch: false,
      walletNetworkPassphrase: undefined,
    });
    const { container } = render(<NetworkMismatchBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an alert banner when connected and the networks disagree", () => {
    mockWallet({
      connected: true,
      networkMismatch: true,
      walletNetworkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    render(<NetworkMismatchBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/wallet network mismatch/i);
    expect(alert).toHaveTextContent(/Mainnet/i);
  });

  it("hides the banner once dismissed, and does not reappear on rerender for the same mismatch (#1277)", () => {
    mockWallet({
      connected: true,
      networkMismatch: true,
      walletNetworkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    const { rerender } = render(<NetworkMismatchBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Same mismatch persists (e.g. an unrelated parent rerender) — still dismissed.
    rerender(<NetworkMismatchBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reappears when a further, different mismatch occurs after being dismissed (#1277)", () => {
    mockWallet({
      connected: true,
      networkMismatch: true,
      walletNetworkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    const { rerender } = render(<NetworkMismatchBanner />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Wallet moves to a *different* mismatched network — a new mismatch, not
    // the one the user already dismissed.
    mockWallet({
      connected: true,
      networkMismatch: true,
      walletNetworkPassphrase: "Test SDF Network ; September 2015",
    });
    rerender(<NetworkMismatchBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Testnet/i);
  });
});
