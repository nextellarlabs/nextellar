/**
 * @jest-environment jsdom
 *
 * SendForm (default template) — multi-asset selection and fee-bump sponsor
 * flows.
 *
 * Rebuilt on the `jest.unstable_mockModule` pattern used by
 * WalletConnectButton.test.tsx: under this repo's ESM Jest setup,
 * CJS-style `jest.mock` cannot intercept the component's imports, and
 * jest.config's moduleNameMapper redirects `../contexts` to
 * src/mocks/wallet-contexts-mock — so both the wallet context and the
 * balances hook are mocked at their mapped specifier, then imported
 * dynamically after the mocks register.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { cleanup } from "@testing-library/react";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
  // The component branches on fee-bump results through this type guard; keep
  // the real shape so the awaiting-sponsor path is exercised end to end.
  isUnsignedFeeBumpResult: (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    (value as { requiresSponsorSignature?: unknown })
      .requiresSponsorSignature === true,
}));

jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

// Dynamic imports (must come after unstable_mockModule).
const [{ default: SendForm }, { useWallet }, { useStellarBalances }] =
  await Promise.all([
    import("../../src/templates/default/src/components/SendForm"),
    import("../../src/mocks/wallet-contexts-mock"),
    import("../../src/templates/default/src/hooks/useStellarBalances"),
  ]);

const VALID_ADDRESS =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

type WalletState = {
  connected: boolean;
  publicKey?: string;
  sendPayment?: (opts: unknown) => Promise<unknown>;
};

function mockWallet(partial: Partial<WalletState> = {}) {
  (useWallet as unknown as jest.Mock).mockReturnValue({
    connected: true,
    publicKey: VALID_ADDRESS,
    sendPayment: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    ...partial,
  });
}

function mockBalances() {
  (useStellarBalances as unknown as jest.Mock).mockReturnValue({
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        balance: "50.0000000",
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopPolling: jest.fn(),
  });
}

describe("SendForm — multi-asset and fee-bump sponsor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet();
    mockBalances();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the multi-asset dropdown and allows selecting a non-native asset", () => {
    render(<SendForm />);

    const assetSelect = screen.getByLabelText("Asset");
    expect(assetSelect).toBeInTheDocument();
    expect(screen.getByText("XLM (Native)")).toBeInTheDocument();

    fireEvent.change(assetSelect, { target: { value: "USDC" } });
    expect(screen.getByLabelText("Amount (USDC)")).toBeInTheDocument();
  });

  it("submits with the selected non-native asset and sponsor, then shows the awaiting-sponsor state", async () => {
    const mockSendPayment = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({
        requiresSponsorSignature: true,
        feeBumpXdr: "TESTXDR",
      });
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: "USDC" },
    });
    fireEvent.change(screen.getByLabelText("Amount (USDC)"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Fee Sponsor (optional fee-bump)"), {
      target: { value: VALID_ADDRESS },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send with Fee-Bump" }));

    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: VALID_ADDRESS,
          amount: "25",
          asset: { code: "USDC", issuer: USDC_ISSUER },
          sponsor: VALID_ADDRESS,
        }),
      );
    });

    // The fee-bump path hands back an unsigned XDR for the sponsor to sign:
    // the form must surface it read-only and flip the status badge.
    expect(await screen.findByText(/awaiting sponsor/i)).toBeInTheDocument();
    const xdrBox = screen.getByLabelText("Unsigned fee-bump transaction XDR");
    expect(xdrBox).toHaveValue("TESTXDR");
    expect(xdrBox).toHaveAttribute("readonly");
  });

  it("submits a native payment without a sponsor and clears the fields on success", async () => {
    const mockSendPayment = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({});
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: VALID_ADDRESS,
          amount: "25",
          asset: "XLM",
          sponsor: undefined,
        }),
      );
    });

    expect(await screen.findByText("Sent")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveValue("");
  });
});
