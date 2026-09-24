/**
 * @jest-environment jsdom
 *
 * TransactionList Component Tests — minimal template (#814)
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

jest.unstable_mockModule(
  "../../src/templates/minimal/src/hooks/useTransactionHistory",
  () => ({
    useTransactionHistory: jest.fn(),
  }),
);

const [{ default: TransactionList }, { useTransactionHistory }, { useWallet }] =
  await Promise.all([
    import("../../src/templates/minimal/src/components/TransactionList"),
    import("../../src/templates/minimal/src/hooks/useTransactionHistory"),
    import("../../src/mocks/wallet-contexts-mock"),
  ]);

const WALLET_ADDRESS =
  "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const OTHER_ADDRESS =
  "GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";

type MockRecord = {
  id: string;
  type: string;
  type_i: number;
  created_at: string;
  transaction_hash: string;
  source_account: string;
  paging_token: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  from?: string;
  to?: string;
  transaction_successful?: boolean;
};

function makeRecord(index: number, overrides: Partial<MockRecord> = {}) {
  return {
    id: `op-${index}`,
    type: "payment",
    type_i: 1,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: OTHER_ADDRESS,
    paging_token: `pt-${index}`,
    amount: `${(100 + index).toFixed(7)}`,
    asset_type: "native",
    from: OTHER_ADDRESS,
    to: WALLET_ADDRESS,
    transaction_successful: true,
    ...overrides,
  };
}

function mockHook(overrides: Record<string, unknown> = {}) {
  (useTransactionHistory as jest.Mock).mockReturnValue({
    items: [] as MockRecord[],
    loading: false,
    error: null,
    hasMore: false,
    fetchNextPage: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe("TransactionList (minimal template)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWallet as jest.Mock).mockReturnValue({
      connected: true,
      publicKey: WALLET_ADDRESS,
    });
  });

  it("shows a loading state (skeleton) while the initial fetch is in flight", () => {
    mockHook({ items: [], loading: true });
    render(<TransactionList />);
    expect(
      screen.getByRole("status", { name: "Loading transaction history" }),
    ).toBeInTheDocument();
  });

  it("shows a connect-wallet empty state when disconnected", () => {
    (useWallet as jest.Mock).mockReturnValue({
      connected: false,
      publicKey: undefined,
    });
    mockHook({ items: [], loading: false, hasMore: false });
    render(<TransactionList />);
    expect(
      screen.getByText(/connect wallet to view transactions/i),
    ).toBeInTheDocument();
  });

  it("shows an empty state for a connected wallet with no transactions", () => {
    mockHook({ items: [], loading: false, hasMore: false });
    render(<TransactionList />);
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("renders an error state with a retry that re-runs the fetch", () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    mockHook({
      items: [],
      loading: false,
      error: new Error("Network error: Horizon unreachable"),
      hasMore: false,
      refresh,
    });
    render(<TransactionList />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/failed to load transactions/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders a paginated list with a Load More button and fetches the next page", async () => {
    const fetchNextPage = jest.fn().mockResolvedValue(undefined);
    mockHook({
      items: [makeRecord(0) as any],
      loading: false,
      hasMore: true,
      fetchNextPage,
    });
    render(<TransactionList />);
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));
  });

  it("renders received and failed rows with the correct presentational hints", () => {
    mockHook({
      items: [
        makeRecord(0, { transaction_successful: true }) as any,
        makeRecord(1, {
          transaction_successful: false,
          source_account: WALLET_ADDRESS,
          from: WALLET_ADDRESS,
          to: OTHER_ADDRESS,
        }) as any,
      ],
      loading: false,
      hasMore: false,
    });
    render(<TransactionList />);
    expect(screen.getAllByLabelText(/received/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/sent/i)).toHaveLength(1);
    expect(screen.getAllByText("Failed").length).toBeGreaterThanOrEqual(1);
  });
});
