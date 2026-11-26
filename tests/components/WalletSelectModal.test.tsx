/**
 * @jest-environment jsdom
 *
 * WalletSelectModal (#911): lists wallets with icons and names and is fully
 * keyboard operable.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

const { default: WalletSelectModal } = await import(
  "../../src/templates/default/src/components/WalletSelectModal"
);

const WALLETS = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "https://example.test/freighter.png",
    isAvailable: true,
  },
  {
    id: "albedo",
    name: "Albedo",
    icon: "https://example.test/albedo.png",
    isAvailable: true,
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "https://example.test/xbull.png",
    isAvailable: false,
    url: "https://xbull.app",
  },
];

function setup(
  props: Partial<React.ComponentProps<typeof WalletSelectModal>> = {},
) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <WalletSelectModal
      open
      wallets={WALLETS}
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...utils, onSelect, onClose };
}

const option = (name: string) =>
  screen.getByText(name).closest("[data-wallet-option]") as HTMLElement;

describe("WalletSelectModal (#911)", () => {
  it("has no axe violations", async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders nothing when closed", () => {
    const { container } = setup({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled modal dialog", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Connect a wallet" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("lists every wallet with its icon and name", () => {
    const { container } = setup();
    for (const wallet of WALLETS) {
      expect(screen.getByText(wallet.name)).toBeInTheDocument();
    }
    const icons = Array.from(container.ownerDocument.querySelectorAll("img"));
    expect(icons.map((img) => img.getAttribute("src"))).toEqual(
      WALLETS.map((w) => w.icon),
    );
    // Icons are decorative next to the visible name.
    for (const img of icons) expect(img).toHaveAttribute("alt", "");
  });

  it("selects an installed wallet on click", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Albedo" }));
    expect(onSelect).toHaveBeenCalledWith("albedo");
  });

  it("links a wallet that is not installed to its install page", () => {
    const { onSelect } = setup();
    const link = screen.getByRole("link", { name: "Install xBull" });
    expect(link).toHaveAttribute("href", "https://xbull.app");
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    fireEvent.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("focuses the first installed wallet on open", () => {
    setup();
    expect(option("Freighter")).toHaveFocus();
  });

  it("moves focus with ArrowDown/ArrowUp and wraps around", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(option("Albedo")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(option("xBull")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(option("Freighter")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(option("xBull")).toHaveFocus();
  });

  it("supports Home and End", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "End" });
    expect(option("xBull")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Home" });
    expect(option("Freighter")).toHaveFocus();
  });

  it("selects the focused wallet with the keyboard (native button)", () => {
    const { onSelect } = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    // A focused <button> activates on Enter/Space natively; jsdom doesn't
    // synthesize that, so click the focused element as the browser would.
    (document.activeElement as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("albedo");
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes from the close button and the backdrop", () => {
    const { onClose, container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("link", { name: "Install xBull" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("shows a loading state while wallets are null", () => {
    setup({ wallets: null });
    expect(screen.getByRole("status")).toHaveTextContent("Loading wallets...");
  });

  it("shows an error instead of the list", () => {
    setup({ error: "Kit failed" });
    expect(screen.getByRole("alert")).toHaveTextContent("Kit failed");
    expect(screen.queryByText("Freighter")).not.toBeInTheDocument();
  });

  it("shows an empty state and focuses Close when no wallets exist", () => {
    setup({ wallets: [] });
    expect(
      screen.getByText("No wallets are configured for this app."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("accepts label overrides for i18n", () => {
    setup({ labels: { title: "Conectar billetera" } });
    expect(
      screen.getByRole("dialog", { name: "Conectar billetera" }),
    ).toBeInTheDocument();
  });
});
