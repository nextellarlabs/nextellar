/**
 * @jest-environment jsdom
 *
 * SendForm Component Tests — minimal template (#1042)
 *
 * Renders the real minimal-template `SendForm` against the shared test helpers so the
 * component's own validation and submit wiring is what is under test:
 * - field validation (required destination / amount, non-positive amount)
 * - submit success (sendPayment called with the typed values, fields clear)
 * - submit-error path (rejection surfaces a "Failed" badge + message)
 * - the disconnected and unsupported-adapter guards
 *
 * `SendForm` reads from the wallet context, which jest maps to
 * src/mocks/wallet-contexts-mock; `render` from tests/helpers wraps the
 * component in that context with the supplied wallet state.
 */
import "@testing-library/jest-dom";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  connectedWallet,
} from "../helpers";
import SendForm from "../../src/templates/minimal/src/components/SendForm";

// A real, checksum-valid Stellar ed25519 public key.
const VALID_ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

function renderForm(
  wallet: Parameters<typeof connectedWallet>[0] = {},
): ReturnType<typeof render> {
  return render(<SendForm />, { wallet: connectedWallet(wallet) });
}

describe("SendForm (minimal template)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("field validation", () => {
    it("disables every field and submit when no wallet is connected", () => {
      renderForm({ connected: false, publicKey: undefined, sendPayment: undefined });

      expect(screen.getByLabelText("To")).toBeDisabled();
      expect(screen.getByLabelText("Amount (XLM)")).toBeDisabled();
      expect(screen.getByLabelText("Memo (optional)")).toBeDisabled();
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
      expect(
        screen.getByText(/connect a wallet to send a payment/i),
      ).toBeInTheDocument();
    });

    it("shows a validation error for an invalid destination and keeps submit disabled", () => {
      const sendPayment = jest.fn();
      renderForm({ sendPayment });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: "not-a-valid-address" },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "10" },
      });

      expect(
        screen.getByText(/valid stellar public key/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
      expect(sendPayment).not.toHaveBeenCalled();
    });

    it("shows a validation error for a non-positive amount and keeps submit disabled", () => {
      const sendPayment = jest.fn();
      renderForm({ sendPayment });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: VALID_ADDRESS },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "-5" },
      });

      expect(screen.getByText(/greater than 0/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
      expect(sendPayment).not.toHaveBeenCalled();
    });

    it("enables submit once a valid destination and amount are entered", () => {
      renderForm({ sendPayment: jest.fn() });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: VALID_ADDRESS },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "25" },
      });

      expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
    });
  });

  describe("submit success", () => {
    it("calls sendPayment with the entered fields, shows Sent, and clears the form", async () => {
      const sendPayment = jest.fn().mockResolvedValue({});
      renderForm({ sendPayment });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: VALID_ADDRESS },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "25" },
      });
      fireEvent.change(screen.getByLabelText("Memo (optional)"), {
        target: { value: "rent" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(sendPayment).toHaveBeenCalledWith({
          to: VALID_ADDRESS,
          amount: "25",
          memo: "rent",
        });
      });

      expect(await screen.findByText("Sent")).toBeInTheDocument();
      expect(screen.getByLabelText("To")).toHaveValue("");
      expect(screen.getByLabelText("Amount (XLM)")).toHaveValue("");
      expect(screen.getByLabelText("Memo (optional)")).toHaveValue("");
    });
  });

  describe("submit error", () => {
    it("shows the Failed badge and the error message when sendPayment rejects", async () => {
      const sendPayment = jest
        .fn()
        .mockRejectedValue(new Error("Insufficient balance"));
      renderForm({ sendPayment });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: VALID_ADDRESS },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "25" },
      });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));

      expect(await screen.findByText("Failed")).toBeInTheDocument();
      expect(
        screen.getByText("Insufficient balance"),
      ).toBeInTheDocument();
      // The form keeps the entered values so the user can retry.
      expect(screen.getByLabelText("To")).toHaveValue(VALID_ADDRESS);
    });
  });

  describe("unsupported adapter", () => {
    it("disables submit and explains when the connected wallet cannot send payments", () => {
      renderForm({ sendPayment: undefined });

      fireEvent.change(screen.getByLabelText("To"), {
        target: { value: VALID_ADDRESS },
      });
      fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
        target: { value: "10" },
      });

      expect(
        screen.getByText(/does not support sending payments/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
    });
  });
});
