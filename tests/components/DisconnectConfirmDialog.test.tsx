/**
 * @jest-environment jsdom
 *
 * DisconnectConfirmDialog (#910): confirm step before disconnecting.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

const { default: DisconnectConfirmDialog } = await import(
  "../../src/templates/default/src/components/DisconnectConfirmDialog"
);

function setup(
  props: Partial<React.ComponentProps<typeof DisconnectConfirmDialog>> = {},
) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const utils = render(
    <DisconnectConfirmDialog
      open
      walletName="Freighter"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe("DisconnectConfirmDialog (#910)", () => {
  it("has no axe violations", async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders nothing when closed", () => {
    const { container } = setup({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled alertdialog naming the wallet and explaining reload", () => {
    setup();
    const dialog = screen.getByRole("alertdialog", {
      name: "Disconnect Freighter?",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      /will not reconnect automatically when you reload/,
    );
  });

  it("focuses Cancel first so an accidental Enter keeps the session", () => {
    setup();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels from the button and from Escape", () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cycles Tab between its two buttons", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Disconnect" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("falls back to a generic name", () => {
    setup({ walletName: undefined });
    expect(
      screen.getByRole("alertdialog", { name: "Disconnect wallet?" }),
    ).toBeInTheDocument();
  });
});
