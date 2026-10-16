/**
 * @jest-environment jsdom
 *
 * NetworkSwitcher keyboard-only network selection (#1143).
 *
 * Arrow keys / Home / End move through the networks without switching,
 * Enter commits the highlighted network, Escape cancels back to the active
 * one, and leaving the control keeps a previewed choice like a native
 * select. Pointer selection still switches immediately (covered in
 * NetworkSwitcher.test.tsx).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import React from "react";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWalletConfig: jest.fn(),
  useWallet: jest.fn(),
  WalletProvider: jest.fn(({ children }: { children: React.ReactNode }) => children),
}));

const [{ default: NetworkSwitcher }, { useWalletConfig, useWallet }] = await Promise.all([
  import("../../src/templates/default/src/components/NetworkSwitcher"),
  import("../../src/mocks/wallet-contexts-mock"),
]);

interface WalletConfigShape {
  activeNetworkKey: string;
  switchNetwork?: (key: string) => void;
  addCustomNetwork?: (key: string, config: unknown) => void;
}

const mockUseWalletConfig = useWalletConfig as unknown as jest.Mock<
  () => WalletConfigShape | undefined
>;
const mockUseWallet = useWallet as unknown as jest.Mock<() => { connected: boolean } | undefined>;

function setup(config: WalletConfigShape, wallet = { connected: false }) {
  mockUseWalletConfig.mockReturnValue(config);
  mockUseWallet.mockReturnValue(wallet);
  render(<NetworkSwitcher />);
  const select = screen.getByRole("combobox", { name: "Network" }) as HTMLSelectElement;
  select.focus();
  return select;
}

const press = (el: HTMLElement, key: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(el, { key, ...init });

describe("NetworkSwitcher keyboard-only selection (#1143)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("selects a network end to end with only the keyboard: Tab, ArrowDown, Enter", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    expect(select).toHaveFocus();
    press(select, "ArrowDown");
    expect(select.value).toBe("mainnet");
    expect(switchNetwork).not.toHaveBeenCalled();

    press(select, "Enter");
    expect(switchNetwork).toHaveBeenCalledTimes(1);
    expect(switchNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("does not switch while arrowing through the options", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    press(select, "ArrowDown");
    press(select, "ArrowUp");
    press(select, "ArrowDown");

    expect(select.value).toBe("mainnet");
    expect(switchNetwork).not.toHaveBeenCalled();
  });

  it("clamps at the ends of the list and supports Home/End", () => {
    const select = setup({ activeNetworkKey: "testnet", switchNetwork: jest.fn() });

    press(select, "ArrowUp");
    expect(select.value).toBe("testnet");

    press(select, "End");
    expect(select.value).toBe("mainnet");
    press(select, "ArrowDown");
    expect(select.value).toBe("mainnet");

    press(select, "Home");
    expect(select.value).toBe("testnet");
  });

  it("Escape cancels the highlighted choice and restores the active network", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    press(select, "ArrowDown");
    press(select, "Escape");

    expect(select.value).toBe("testnet");
    press(select, "Enter");
    expect(switchNetwork).not.toHaveBeenCalled();
  });

  it("Enter without a highlighted change does nothing", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    press(select, "Enter");

    expect(switchNetwork).not.toHaveBeenCalled();
  });

  it("leaving the control keeps the previewed network, like a native select", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    press(select, "ArrowDown");
    fireEvent.blur(select);

    expect(switchNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("asks for confirmation once, on Enter, when a wallet is connected", () => {
    const switchNetwork = jest.fn();
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
    const select = setup({ activeNetworkKey: "testnet", switchNetwork }, { connected: true });

    press(select, "ArrowDown");
    press(select, "ArrowUp");
    press(select, "ArrowDown");
    expect(confirm).not.toHaveBeenCalled();

    press(select, "Enter");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(switchNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("restores the active network when the confirmation is declined", () => {
    const switchNetwork = jest.fn();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    const select = setup({ activeNetworkKey: "testnet", switchNetwork }, { connected: true });

    press(select, "ArrowDown");
    press(select, "Enter");

    expect(switchNetwork).not.toHaveBeenCalled();
    expect(select.value).toBe("testnet");
  });

  it("reaches the add-custom-network entry and opens its form with Enter", () => {
    const select = setup({
      activeNetworkKey: "testnet",
      switchNetwork: jest.fn(),
      addCustomNetwork: jest.fn(),
    });

    press(select, "End");
    expect(select.value).toBe("__add_custom_network__");
    press(select, "Enter");

    expect(screen.getByRole("form", { name: "Add custom network" })).toBeInTheDocument();
  });

  it("treats type-ahead changes as navigation, not a commit", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    press(select, "m");
    fireEvent.change(select, { target: { value: "mainnet" } });
    expect(switchNetwork).not.toHaveBeenCalled();

    press(select, "Enter");
    expect(switchNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("leaves Alt+ArrowDown to the browser so it can open the option list", () => {
    const switchNetwork = jest.fn();
    const select = setup({ activeNetworkKey: "testnet", switchNetwork });

    const notPrevented = press(select, "ArrowDown", { altKey: true });

    expect(notPrevented).toBe(true);
    expect(select.value).toBe("testnet");
  });

  it("describes the keyboard controls to screen readers", () => {
    const select = setup({ activeNetworkKey: "testnet", switchNetwork: jest.fn() });

    const hint = document.getElementById(select.getAttribute("aria-describedby")!);
    expect(hint).toHaveTextContent(/arrow keys.*Enter.*Escape/i);
  });
});
