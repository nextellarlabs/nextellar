/**
 * @jest-environment jsdom
 */
import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  type Operation,
} from "@stellar/stellar-sdk";

expect.extend(toHaveNoViolations);
import { I18nProvider } from "../../src/templates/default/src/contexts/I18nProvider";
import type {
  StellarAccountDetails,
  StellarAccountState,
} from "../../src/templates/default/src/hooks/useStellarAccount";

const MASTER_KEY = Keypair.random().publicKey();
const COSIGNER_A = Keypair.random().publicKey();
const COSIGNER_B = Keypair.random().publicKey();

const mockRefresh = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
let mockHookState: StellarAccountState;

await jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: () => ({
    connected: true,
    publicKey: MASTER_KEY,
    networkMismatch: false,
  }),
  useWalletConfig: () => ({
    horizonUrl: "https://horizon-testnet.stellar.org",
    network: Networks.TESTNET,
  }),
}));

await jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useStellarAccount",
  () => ({
    useStellarAccount: () => mockHookState,
  }),
);

const { default: SignerManager, analyzeSignerLockoutRisks } =
  await import("../../src/templates/default/src/components/SignerManager");

function makeFundedState(
  overrides: Partial<StellarAccountDetails> = {},
): StellarAccountState {
  const details: StellarAccountDetails = {
    id: MASTER_KEY,
    accountId: MASTER_KEY,
    sequence: "50000001",
    subentryCount: 2,
    thresholds: {
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 2,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
    },
    signers: [
      { key: MASTER_KEY, weight: 2, type: "ed25519_public_key" },
      { key: COSIGNER_A, weight: 1, type: "ed25519_public_key" },
    ],
    ...overrides,
  };
  return {
    account: details,
    signers: details.signers,
    thresholds: details.thresholds,
    flags: details.flags,
    sequence: details.sequence,
    exists: true,
    loading: false,
    error: null,
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    refresh: mockRefresh,
  };
}

describe("SignerManager (#1465)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHookState = makeFundedState();
  });

  describe("analyzeSignerLockoutRisks helper", () => {
    it("detects zero total weight and master-key lockout with no co-signers", () => {
      const res = analyzeSignerLockoutRisks({
        accountId: MASTER_KEY,
        currentSigners: [
          { key: MASTER_KEY, weight: 1, type: "ed25519_public_key" },
        ],
        masterWeight: 0,
        lowThreshold: 0,
        medThreshold: 0,
        highThreshold: 0,
        stagedAdditions: [],
        stagedRemovals: [],
      });

      expect(res.effectiveTotalWeight).toBe(0);
      expect(res.hasCriticalLockout).toBe(true);
      expect(res.risks.map((r) => r.code)).toContain("zero_total_weight");
    });

    it("detects thresholds exceeding effective total weight after signer removal", () => {
      const res = analyzeSignerLockoutRisks({
        accountId: MASTER_KEY,
        currentSigners: [
          { key: MASTER_KEY, weight: 1, type: "ed25519_public_key" },
          { key: COSIGNER_A, weight: 2, type: "ed25519_public_key" },
        ],
        masterWeight: 1,
        lowThreshold: 2,
        medThreshold: 2,
        highThreshold: 3,
        stagedAdditions: [],
        stagedRemovals: [COSIGNER_A],
      });

      expect(res.effectiveTotalWeight).toBe(1);
      expect(res.risks.map((r) => r.code)).toEqual([
        "below_low_threshold",
        "below_med_threshold",
        "below_high_threshold",
      ]);
    });
  });

  it("renders current signers & thresholds and builds a valid multi-operation setOptions XDR", async () => {
    const onTransactionBuilt = jest.fn();

    render(
      <I18nProvider>
        <SignerManager onTransactionBuilt={onTransactionBuilt} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Account Signers & Thresholds" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Master key")).toBeInTheDocument();
    expect(screen.getByText("Co-signer")).toBeInTheDocument();

    // Update medium and high thresholds to 3 and add COSIGNER_B with weight 2
    fireEvent.change(screen.getByLabelText("Medium threshold (0-255)"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("High threshold (0-255)"), {
      target: { value: "3" },
    });

    fireEvent.change(screen.getByLabelText("Co-signer public key (G...)"), {
      target: { value: COSIGNER_B },
    });
    fireEvent.change(screen.getByLabelText("Signer weight (1-255)"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage signer" }));

    // Also mark COSIGNER_A for removal (weight -> 0)
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      screen.getByText("Pending removal (weight -> 0)"),
    ).toBeInTheDocument();

    // Effective total weight = master (2) + COSIGNER_B (2) = 4 >= highThreshold (3), so no lockout warning!
    expect(
      screen.queryByText("Account Lockout Risk Detected"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Build setOptions Transaction" }),
    );

    await waitFor(() => {
      expect(onTransactionBuilt).toHaveBeenCalledTimes(1);
    });

    const [xdr, summary] = onTransactionBuilt.mock.calls[0] as [
      string,
      { operationCount: number; effectiveTotalWeight: number },
    ];
    expect(summary.operationCount).toBe(2);
    expect(summary.effectiveTotalWeight).toBe(4);

    // Parse XDR with @stellar/stellar-sdk to verify exact setOptions fields
    const parsedTx = TransactionBuilder.fromXDR(
      xdr,
      Networks.TESTNET,
    ) as Transaction;
    expect(parsedTx.operations).toHaveLength(2);

    const op0 = parsedTx.operations[0] as Operation.SetOptions;
    expect(op0.type).toBe("setOptions");
    expect(op0.medThreshold).toBe(3);
    expect(op0.highThreshold).toBe(3);
    expect(op0.signer).toEqual({
      ed25519PublicKey: COSIGNER_A,
      weight: 0,
    });

    const op1 = parsedTx.operations[1] as Operation.SetOptions;
    expect(op1.type).toBe("setOptions");
    expect(op1.signer).toEqual({
      ed25519PublicKey: COSIGNER_B,
      weight: 2,
    });
  });

  it("warns and blocks building setOptions until lockout acknowledgement is checked", async () => {
    const onTransactionBuilt = jest.fn();

    render(
      <I18nProvider>
        <SignerManager onTransactionBuilt={onTransactionBuilt} />
      </I18nProvider>,
    );

    // Raise high threshold to 10 (exceeding total signer weight 3)
    fireEvent.change(screen.getByLabelText("High threshold (0-255)"), {
      target: { value: "10" },
    });

    expect(
      screen.getByRole("heading", { name: "Account Lockout Risk Detected" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/below the high threshold \(10\)/),
    ).toBeInTheDocument();

    // Clicking build without checking confirmation is blocked
    fireEvent.click(
      screen.getByRole("button", { name: "Build setOptions Transaction" }),
    );
    expect(onTransactionBuilt).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Confirm the lockout warning checkbox before building this high-risk setOptions transaction.",
      ),
    ).toBeInTheDocument();

    // Checking the acknowledgement box enables building
    fireEvent.click(
      screen.getByLabelText(
        "I understand these settings can permanently lock this Stellar account or restrict future signer updates.",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Build setOptions Transaction" }),
    );

    await waitFor(() => {
      expect(onTransactionBuilt).toHaveBeenCalledTimes(1);
    });
  });

  it("renders unfunded and error states cleanly", () => {
    mockHookState = {
      ...makeFundedState(),
      account: null,
      signers: [],
      thresholds: null,
      exists: false,
    };

    const { rerender } = render(<SignerManager />);
    expect(
      screen.getByText(/has not been funded on the selected network yet/),
    ).toBeInTheDocument();

    mockHookState = {
      ...makeFundedState(),
      account: null,
      signers: [],
      thresholds: null,
      exists: false,
      error: new Error("Horizon timeout"),
    };
    rerender(<SignerManager />);
    expect(screen.getByRole("alert")).toHaveTextContent("Horizon timeout");
  });

  it("has zero jest-axe accessibility violations in normal and lockout-warning states", async () => {
    const { container } = render(
      <I18nProvider>
        <SignerManager />
      </I18nProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.change(screen.getByLabelText("Master key weight (0-255)"), {
      target: { value: "0" },
    });
    expect(
      screen.getByRole("heading", { name: "Account Lockout Risk Detected" }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
