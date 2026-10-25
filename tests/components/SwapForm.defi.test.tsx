/**
 * @jest-environment jsdom
 *
 * Component tests for the defi template's SwapForm (path payments / DEX
 * swaps). Horizon is mocked at the network boundary; the real
 * `usePathPayment` hook and the real SDK build the transactions.
 */
import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockLoadAccount,
  mockSubmitTransaction,
  mockStrictSendPathsCall,
  mockStrictReceivePathsCall,
  resetHorizonMocks,
  createHorizonMock,
} = await import("../../src/mocks/stellar-horizon-mock.js");

await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return createHorizonMock(actual);
});

const { Keypair, Account, Transaction, Networks } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");
const { WalletContext } = await import("../../src/mocks/wallet-contexts-mock");
const { default: SwapForm } =
  await import("../../src/templates/defi/src/components/SwapForm");

const FROM = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const USDC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const BTC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11)).publicKey();

const BALANCES = [
  { asset_type: "native", balance: "500.0000000" },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    balance: "10.0000000",
  },
];

const signTransaction = jest.fn() as jest.Mock<(xdr: string) => Promise<string>>;

function renderForm(wallet: Record<string, unknown> = {}) {
  const value = {
    connected: true,
    publicKey: FROM,
    walletName: "Freighter",
    balances: BALANCES,
    accounts: [],
    currentAccountIndex: 0,
    connect: async () => {},
    disconnect: () => {},
    refreshBalances: async () => {},
    switchAccount: async () => {},
    signTransaction,
    ...wallet,
  };
  return render(
    <WalletContext.Provider value={value as never}>
      <SwapForm />
    </WalletContext.Provider>,
  );
}

function sendRecord(sourceAmount: string, destinationAmount: string, withHop = true) {
  return {
    source_asset_type: "native",
    source_amount: sourceAmount,
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: USDC_ISSUER,
    destination_amount: destinationAmount,
    path: withHop
      ? [{ asset_type: "credit_alphanum4", asset_code: "BTC", asset_issuer: BTC_ISSUER }]
      : [],
  };
}

function fillForm(amount = "100") {
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: `USDC:${USDC_ISSUER}` },
  });
  fireEvent.change(screen.getByLabelText(/Amount to (send|receive)/), {
    target: { value: amount },
  });
}

describe("SwapForm (defi)", () => {
  beforeEach(() => {
    resetHorizonMocks();
    signTransaction.mockReset();
    mockLoadAccount.mockResolvedValue(new Account(FROM, "5"));
  });

  it("disables everything and prompts to connect when no wallet is connected", () => {
    renderForm({ connected: false, publicKey: undefined, signTransaction: undefined });

    expect(screen.getByText("Connect a wallet to swap.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find route" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
  });

  it("shows the chosen path, estimate and slippage-protected minimum (strict-send)", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.0000000", false), sendRecord("100.0000000", "12.5000000")],
    });
    renderForm();
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    // The best (highest-output) route wins.
    expect(await screen.findByTestId("swap-route")).toHaveTextContent("XLM → BTC → USDC");
    expect(screen.getByText("You receive (estimated)")).toBeInTheDocument();
    expect(screen.getByText("12.5000000 USDC")).toBeInTheDocument();
    // 12.5 less the default 1% slippage.
    expect(screen.getByTestId("swap-bound")).toHaveTextContent("12.3750000 USDC");
    expect(screen.getByRole("button", { name: "Swap" })).toBeEnabled();
  });

  it("updates the bound when the slippage tolerance changes", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.5000000")],
    });
    renderForm();
    fillForm();
    fireEvent.change(screen.getByLabelText("Slippage tolerance (%)"), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    expect(await screen.findByTestId("swap-bound")).toHaveTextContent("12.2500000 USDC");
  });

  it("shows the maximum sent in strict-receive mode", async () => {
    mockStrictReceivePathsCall.mockResolvedValue({
      records: [sendRecord("98.0000000", "12.0000000")],
    });
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Exact amount to receive" }));
    fillForm("12");

    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    expect(await screen.findByText("Maximum sent")).toBeInTheDocument();
    // 98 plus the default 1% slippage.
    expect(screen.getByTestId("swap-bound")).toHaveTextContent("98.9800000 XLM");
  });

  it("reports when no route is available and keeps Swap disabled", async () => {
    mockStrictSendPathsCall.mockResolvedValue({ records: [] });
    renderForm();
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: "Find route" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No route found");
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
  });

  it("validates the pair, amount and slippage locally", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "XLM" } });
    expect(screen.getByText("Choose two different assets.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Amount to send/), { target: { value: "-5" } });
    expect(screen.getByText(/Enter an amount greater than 0/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Slippage tolerance (%)"), {
      target: { value: "80" },
    });
    expect(screen.getByText(/Enter a slippage between 0 and 50%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find route" })).toBeDisabled();
  });

  it("builds, signs and submits a strict-send swap with the slippage bound", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.5000000")],
    });
    signTransaction.mockImplementation(async (xdr) => xdr);
    mockSubmitTransaction.mockResolvedValue({ hash: "swaphash" });
    renderForm();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await screen.findByTestId("swap-route");

    fireEvent.click(screen.getByRole("button", { name: "Swap" }));

    expect(await screen.findByText("Swap submitted: swaphash")).toBeInTheDocument();
    const signedXdr = signTransaction.mock.calls[0][0];
    const op = new Transaction(signedXdr, Networks.TESTNET).operations[0] as unknown as {
      type: string;
      sendAmount: string;
      destMin: string;
      destination: string;
    };
    expect(op.type).toBe("pathPaymentStrictSend");
    expect(op.sendAmount).toBe("100.0000000");
    expect(op.destMin).toBe("12.3750000");
    expect(op.destination).toBe(FROM);
  });

  it("shows the decoded error when the network rejects the swap", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.5000000")],
    });
    signTransaction.mockImplementation(async (xdr) => xdr);
    mockSubmitTransaction.mockRejectedValue({
      response: {
        status: 400,
        data: {
          extras: {
            result_codes: { transaction: "tx_failed", operations: ["op_under_dest_min"] },
          },
        },
      },
    });
    renderForm();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await screen.findByTestId("swap-route");

    fireEvent.click(screen.getByRole("button", { name: "Swap" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/slippage tolerance exceeded/i),
    );
  });

  it("surfaces a wallet signing rejection", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.5000000")],
    });
    signTransaction.mockRejectedValue(new Error("User declined"));
    renderForm();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await screen.findByTestId("swap-route");

    fireEvent.click(screen.getByRole("button", { name: "Swap" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User declined");
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it("drops a stale quote when the inputs change", async () => {
    mockStrictSendPathsCall.mockResolvedValue({
      records: [sendRecord("100.0000000", "12.5000000")],
    });
    renderForm();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Find route" }));
    await screen.findByTestId("swap-route");

    fireEvent.change(screen.getByLabelText(/Amount to send/), { target: { value: "200" } });

    expect(screen.queryByTestId("swap-route")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
  });
});
