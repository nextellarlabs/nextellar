/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendForm from "../../src/templates/default/src/components/SendForm";

const mockSendPayment = jest.fn();

jest.mock("../../src/templates/default/src/contexts", () => ({
  useWallet: () => ({
    connected: true,
    address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    sendPayment: mockSendPayment,
  }),
}));

jest.mock("../../src/templates/default/src/hooks/useStellarBalances", () => ({
  useStellarBalances: () => ({
    balances: [
      { asset_type: "native", balance: "100.00" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", balance: "50.00" },
    ],
    loading: false,
  }),
}));

describe("SendForm with Multi-Asset and Fee-Bump", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders multi-asset dropdown and allows selecting non-native asset", () => {
    render(<SendForm />);

    expect(screen.getByLabelText("Asset")).toBeInTheDocument();
    expect(screen.getByText("XLM (Native)")).toBeInTheDocument();
    expect(screen.getByText(/USDC/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: "USDC" } });
    expect(screen.getByText("Amount (USDC)")).toBeInTheDocument();
  });

  it("submits payment with selected non-native asset and optional fee-bump sponsor", async () => {
    mockSendPayment.mockResolvedValueOnce({ success: true, txHash: "tx_123" });
    render(<SendForm />);

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    });
    fireEvent.change(screen.getByLabelText("Asset"), { target: { value: "USDC" } });
    fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Fee Sponsor (optional fee-bump)"), {
      target: { value: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H" },
    });

    const submitBtn = screen.getByRole("button", { name: "Send with Fee-Bump" });
    expect(submitBtn).toBeInTheDocument();

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          amount: "25",
          asset: {
            code: "USDC",
            issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          },
          sponsor: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        })
      );
    });
  });
});
