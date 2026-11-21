import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContractCallForm } from "../components/ContractCallForm";

const mockFunctions = [
  {
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
  },
];

const VALID_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

function renderForm(overrides: Partial<React.ComponentProps<typeof ContractCallForm>> = {}) {
  const props = {
    abi: mockFunctions,
    contractAddress: VALID_ADDRESS,
    onSimulate: vi.fn().mockResolvedValue({ success: true, result: "ok" }),
    onSubmit: vi.fn().mockResolvedValue({ hash: "0xabc" }),
    ...overrides,
  };
  render(<ContractCallForm {...props} />);
  return props;
}

describe("ContractCallForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("function selection and argument inputs", () => {
    it("lists all functions from the ABI", () => {
      renderForm();
      const select = screen.getByRole("combobox", { name: /function/i });
      expect(select).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "transfer" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "balanceOf" })).toBeInTheDocument();
    });

    it("renders an input for each argument of the selected function", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    });

    it("updates argument inputs when the function changes", async () => {
      const user = userEvent.setup();
      renderForm();
      const select = screen.getByRole("combobox", { name: /function/i });
      await user.selectOptions(select, "transfer");
      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
      await user.selectOptions(select, "balanceOf");
      expect(screen.queryByLabelText(/amount/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/owner/i)).toBeInTheDocument();
    });

    it("captures user input into argument fields", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      const amount = screen.getByLabelText(/amount/i) as HTMLInputElement;
      await user.type(amount, "500");
      expect(amount.value).toBe("500");
    });
  });

  describe("validation", () => {
    it("shows an error for an invalid address argument", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      await user.type(screen.getByLabelText(/to/i), "not-an-address");
      fireEvent.blur(screen.getByLabelText(/to/i));
      expect(await screen.findByText(/invalid address/i)).toBeInTheDocument();
    });

    it("shows an error for a non-numeric uint256 argument", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      await user.type(screen.getByLabelText(/amount/i), "abc");
      fireEvent.blur(screen.getByLabelText(/amount/i));
      expect(await screen.findByText(/invalid number/i)).toBeInTheDocument();
    });

    it("disables submit while required arguments are empty", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      expect(screen.getByRole("button", { name: /simulate/i })).toBeDisabled();
    });

    it("enables simulate once all arguments are valid", async () => {
      const user = userEvent.setup();
      renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      await user.type(screen.getByLabelText(/to/i), VALID_ADDRESS);
      await user.type(screen.getByLabelText(/amount/i), "10");
      expect(screen.getByRole("button", { name: /simulate/i })).toBeEnabled();
    });
  });

  describe("simulate-then-submit flow", () => {
    async function fillTransfer(user: ReturnType<typeof userEvent.setup>) {
      await user.selectOptions(screen.getByRole("combobox", { name: /function/i }), "transfer");
      await user.type(screen.getByLabelText(/to/i), VALID_ADDRESS);
      await user.type(screen.getByLabelText(/amount/i), "10");
    }

    it("calls onSimulate with the function name and args before submitting", async () => {
      const user = userEvent.setup();
      const props = renderForm();
      await fillTransfer(user);
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      await waitFor(() => expect(props.onSimulate).toHaveBeenCalledTimes(1));
      expect(props.onSimulate).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "transfer", args: [VALID_ADDRESS, "10"] }),
      );
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("shows the submit button only after a successful simulation", async () => {
      const user = userEvent.setup();
      renderForm();
      await fillTransfer(user);
      expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      expect(await screen.findByRole("button", { name: /submit/i })).toBeEnabled();
    });

    it("calls onSubmit when submit is clicked after successful simulation", async () => {
      const user = userEvent.setup();
      const props = renderForm();
      await fillTransfer(user);
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      await user.click(await screen.findByRole("button", { name: /submit/i }));
      await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
      expect(props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: "transfer", args: [VALID_ADDRESS, "10"] }),
      );
    });

    it("displays the simulation error and does not allow submit when simulation fails", async () => {
      const user = userEvent.setup();
      const props = renderForm({
        onSimulate: vi.fn().mockResolvedValue({ success: false, error: "execution reverted" }),
      });
      await fillTransfer(user);
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      expect(await screen.findByText(/execution reverted/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
      expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it("resets the simulation result when arguments change", async () => {
      const user = userEvent.setup();
      renderForm();
      await fillTransfer(user);
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      await screen.findByRole("button", { name: /submit/i });
      await user.type(screen.getByLabelText(/amount/i), "5");
      expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    });

    it("shows the transaction hash after a successful submit", async () => {
      const user = userEvent.setup();
      renderForm();
      await fillTransfer(user);
      await user.click(screen.getByRole("button", { name: /simulate/i }));
      await user.click(await screen.findByRole("button", { name: /submit/i }));
      expect(await screen.findByText(/0xabc/)).toBeInTheDocument();
    });
  });
});
