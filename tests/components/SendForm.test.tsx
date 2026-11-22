/**
 * @jest-environment jsdom
 */
import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockSendPayment = jest.fn();

// SendForm's "../contexts" import resolves to the shared wallet mock via
// jest.config's moduleNameMapper, so that is the module to override here.
await jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: () => ({
    connected: true,
    address: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    sendPayment: mockSendPayment,
  }),
  isUnsignedFeeBumpResult: (value: unknown) =>
    (value as { requiresSponsorSignature?: unknown } | null)
      ?.requiresSponsorSignature === true,
}));

await jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: () => ({
      balances: [
        { asset_type: "native", balance: "100.00" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer:
            "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          balance: "50.00",
        },
      ],
      loading: false,
    }),
  }),
);

const { default: SendForm } =
  await import("../../src/templates/default/src/components/SendForm");

describe("SendForm with Multi-Asset and Fee-Bump", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders multi-asset dropdown and allows selecting non-native asset", () => {
    render(<SendForm />);

    expect(screen.getByLabelText("Asset")).toBeInTheDocument();
    expect(screen.getByText("XLM (Native)")).toBeInTheDocument();
    expect(screen.getByText(/USDC/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: "USDC" },
    });
    expect(screen.getByText("Amount (USDC)")).toBeInTheDocument();
  });

  it("submits payment with selected non-native asset and optional fee-bump sponsor", async () => {
    mockSendPayment.mockResolvedValueOnce({ success: true, txHash: "tx_123" });
    render(<SendForm />);

    fireEvent.change(screen.getByLabelText("To"), {
      target: {
        value: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      },
    });
    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: "USDC" },
    });
    fireEvent.change(screen.getByLabelText("Amount (USDC)"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Fee Sponsor (optional fee-bump)"), {
      target: {
        value: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      },
    });

    const submitBtn = screen.getByRole("button", {
      name: "Send with Fee-Bump",
    });
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
        }),
      );
    });
  });
});
