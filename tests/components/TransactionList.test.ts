/**
 * @jest-environment jsdom
 *
 * TransactionList Component Tests
 *
 * Covers:
 * - Direction (sent/received)
 * - Pagination (load more, hasMore, loading state)
 * - Empty state (no transactions)
 * - Loading state (initial skeleton)
 * - Props (limit, type)
 * - Rendering (type label, amount/asset, address truncation, relative time)
 * - Error handling
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";

// ── Mock useWallet from contexts ──────────────────────────────────────────────
jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

// ── Mock useTransactionHistory hook ───────────────────────────────────────────
jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useTransactionHistory",
  () => ({
    useTransactionHistory: jest.fn(),
  }),
);

// ── Dynamic imports (must be after unstable_mockModule) ───────────────────────
const [{ default: TransactionList }, { useTransactionHistory }, { useWallet }] =
  await Promise.all([
    import("../../src/templates/default/src/components/TransactionList"),
    import("../../src/templates/default/src/hooks/useTransactionHistory"),
    import("../../src/mocks/wallet-contexts-mock"),
  ]);

// ── Type helpers ──────────────────────────────────────────────────────────────

type MockTransaction = {
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
  asset_issuer?: string;
  from?: string;
  to?: string;
  transaction_successful?: boolean;
};

// ── Test data factories ───────────────────────────────────────────────────────

const WALLET_ADDRESS =
  "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const OTHER_ADDRESS =
  "GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";

function makePaymentRecord(
  overrides: Partial<MockTransaction & { isReceived?: boolean }> = {},
): MockTransaction {
  const isReceived = overrides.isReceived ?? true;
  const index = overrides.id
    ? parseInt(overrides.id.replace("op-", ""), 10) || 0
    : 0;
  return {
    id: `op-${index}`,
    type: "payment",
    type_i: 1,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: isReceived ? OTHER_ADDRESS : WALLET_ADDRESS,
    paging_token: `pt-${index}`,
    amount: `${(100 + index).toFixed(7)}`,
    asset_type: "native",
    from: isReceived ? OTHER_ADDRESS : WALLET_ADDRESS,
    to: isReceived ? WALLET_ADDRESS : OTHER_ADDRESS,
    transaction_successful: true,
    ...overrides,
  };
}

function makeNonPaymentRecord(
  overrides: Partial<MockTransaction> = {},
): MockTransaction {
  const index = overrides.id
    ? parseInt(overrides.id.replace("op-", ""), 10) || 0
    : 0;
  return {
    id: `op-${index}`,
    type: "create_account",
    type_i: 0,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: OTHER_ADDRESS,
    paging_token: `pt-${index}`,
    transaction_successful: true,
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockHookReturn(
  partial: Partial<{
    items: MockTransaction[];
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    fetchNextPage: () => Promise<void>;
    refresh: () => Promise<void>;
  }>,
) {
  const defaultReturn = {
    items: [] as MockTransaction[],
    loading: false,
    error: null,
    hasMore: false,
    fetchNextPage: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  (useTransactionHistory as jest.Mock).mockReturnValue({
    ...defaultReturn,
    ...partial,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionList Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWallet as jest.Mock).mockReturnValue({
      connected: true,
      publicKey: WALLET_ADDRESS,
    });
  });

  // ── 1. Direction ────────────────────────────────────────────────────────

  describe("direction indicators", () => {
    it("renders a received transaction with incoming indicator", () => {
      const receivedTx = makePaymentRecord({ isReceived: true });
      mockHookReturn({ items: [receivedTx as any] });

      render(React.createElement(TransactionList));
      expect(screen.getByLabelText("Received")).toBeInTheDocument();
    });

    it("renders a sent transaction with outgoing indicator", () => {
      const sentTx = makePaymentRecord({ isReceived: false });
      mockHookReturn({ items: [sentTx as any] });

      render(React.createElement(TransactionList));
      expect(screen.getByLabelText("Sent")).toBeInTheDocument();
    });
  });

  // ── 2. Pagination ───────────────────────────────────────────────────────

  describe("pagination", () => {
    it('renders "Load More" button when hasMore is true', () => {
      const items = [
        makePaymentRecord({ id: "op-0", isReceived: true }),
        makePaymentRecord({ id: "op-1", isReceived: false }),
      ];
      mockHookReturn({ items: items as any[], hasMore: true, loading: false });

      render(React.createElement(TransactionList));
      expect(
        screen.getByRole("button", { name: /load more/i }),
      ).toBeInTheDocument();
    });

    it('does NOT render "Load More" button when hasMore is false', () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[], hasMore: false, loading: false });

      render(React.createElement(TransactionList));
      expect(
        screen.queryByRole("button", { name: /load more/i }),
      ).not.toBeInTheDocument();
    });

    it('calls fetchNextPage when "Load More" is clicked', async () => {
      const fetchNextPage = jest.fn().mockResolvedValue(undefined);
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({
        items: items as any[],
        hasMore: true,
        loading: false,
        fetchNextPage,
      });

      render(React.createElement(TransactionList));

      const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(fetchNextPage).toHaveBeenCalledTimes(1);
      });
    });

    it('shows loading state on the "Load More" button while fetching', () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[], hasMore: true, loading: true });

      render(React.createElement(TransactionList));

      const loadMoreBtn = screen.getByRole("button", {
        name: /loading more/i,
      });
      expect(loadMoreBtn).toBeDisabled();
    });
  });

  // ── 3. Empty state ──────────────────────────────────────────────────────

  describe("empty state", () => {
    it("renders a no-transactions message when there are no items and not loading", () => {
      mockHookReturn({ items: [], loading: false, hasMore: false });

      render(React.createElement(TransactionList));
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
    });

    it("renders a connect-wallet message when wallet is not connected", () => {
      (useWallet as jest.Mock).mockReturnValue({
        connected: false,
        publicKey: undefined,
      });
      mockHookReturn({ items: [], loading: false, hasMore: false });

      render(React.createElement(TransactionList));
      expect(screen.getByText(/connect wallet/i)).toBeInTheDocument();
    });
  });

  // ── 4. Loading state ────────────────────────────────────────────────────

  describe("loading state", () => {
    it("renders 4 skeleton rows when initially loading", () => {
      mockHookReturn({ items: [], loading: true, hasMore: false });

      render(React.createElement(TransactionList));

      // The list of rows is now a single labeled status region (via the
      // shared SkeletonList component) rather than 4 individually-labeled
      // rows, so a screen reader announces the loading state once instead
      // of 4 redundant times.
      expect(
        screen.getByRole("status", { name: "Loading transaction history" }),
      ).toBeInTheDocument();
      const skeletons = screen
        .getByRole("status", { name: "Loading transaction history" })
        .querySelectorAll(".animate-pulse");
      // Each row renders 5 pulsing blocks (avatar + 2 lines + 2 lines).
      expect(skeletons).toHaveLength(4 * 5);
    });
  });

  // ── 5. Props ────────────────────────────────────────────────────────────

  describe("props", () => {
    it("passes default limit=10 to useTransactionHistory", () => {
      mockHookReturn({ items: [], loading: false });

      render(React.createElement(TransactionList));

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 10 }),
      );
    });

    it("passes a custom limit to useTransactionHistory", () => {
      mockHookReturn({ items: [], loading: false });

      render(React.createElement(TransactionList, { limit: 25 }));

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 25 }),
      );
    });

    it('passes type="payments" to useTransactionHistory', () => {
      mockHookReturn({ items: [], loading: false });

      render(React.createElement(TransactionList, { type: "payments" }));

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: "payments" }),
      );
    });

    it('passes type="operations" to useTransactionHistory', () => {
      mockHookReturn({ items: [], loading: false });

      render(React.createElement(TransactionList, { type: "operations" }));

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: "operations" }),
      );
    });
  });

  // ── 6. Rendering details ────────────────────────────────────────────────

  describe("rendering details", () => {
    it("displays a human-readable transaction type", () => {
      const items = [
        makePaymentRecord({ id: "op-0", type: "payment", isReceived: true }),
        makeNonPaymentRecord({ id: "op-1", type: "create_account" }),
      ];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      // Payment appears once in the payment type label
      expect(screen.getByText("Payment")).toBeInTheDocument();
      // Create Account appears twice: type label + non-payment amount slot
      expect(
        screen.getAllByText("Create Account").length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("displays payment amount and asset for payment operations", () => {
      const items = [
        makePaymentRecord({
          id: "op-0",
          isReceived: true,
          amount: "123.4567890",
        }),
      ];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      // The amount should appear with + prefix for received
      expect(screen.getByText(/^\+/)).toBeInTheDocument();
      // XLM asset should be visible
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    it("displays non-payment representation for operations without amounts", () => {
      const items = [makeNonPaymentRecord({ id: "op-0" })];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      // For non-payment ops, the type name appears in both the
      // type label and the amount slot (two times)
      expect(screen.getAllByText("Create Account")).toHaveLength(2);
    });

    it("truncates a long address", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      // The counterparty OTHER_ADDRESS should be truncated
      const truncated =
        OTHER_ADDRESS.slice(0, 4) + "..." + OTHER_ADDRESS.slice(-4);
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it("displays relative time for a transaction", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      // The most recent transaction should show a time indicator
      expect(
        screen.getByText(/just now|m ago|h ago|d ago/),
      ).toBeInTheDocument();
    });

    it("displays a failed status when transaction_successful is false", () => {
      const items = [
        makePaymentRecord({
          id: "op-0",
          isReceived: true,
          transaction_successful: false,
        }),
      ];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    it("handles missing counterparty gracefully", () => {
      const items = [
        {
          id: "op-0",
          type: "manage_data",
          type_i: 10,
          created_at: new Date().toISOString(),
          transaction_hash: "txhash-0",
          source_account: "",
          paging_token: "pt-0",
        },
      ];
      mockHookReturn({ items: items as any[] });

      render(React.createElement(TransactionList));

      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });
  });

  // ── 7. Error handling ──────────────────────────────────────────────────

  describe("error handling", () => {
    it("renders an error state when hook returns an error with no items", () => {
      mockHookReturn({
        items: [],
        loading: false,
        error: new Error("Network error"),
        hasMore: false,
      });

      render(React.createElement(TransactionList));

      expect(
        screen.getByText(/failed to load transactions/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });

    it("calls refresh when retry button is clicked in error state", () => {
      const refresh = jest.fn().mockResolvedValue(undefined);
      mockHookReturn({
        items: [],
        loading: false,
        error: new Error("Network error"),
        hasMore: false,
        refresh,
      });

      render(React.createElement(TransactionList));

      const retryBtn = screen.getByRole("button", { name: /retry/i });
      fireEvent.click(retryBtn);

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("renders an error banner when items exist but error is set", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({
        items: items as any[],
        loading: false,
        error: new Error("Failed to load more"),
        hasMore: true,
      });

      render(React.createElement(TransactionList));

      // Error banner should be visible along with items
      expect(screen.getByText(/failed to load more/i)).toBeInTheDocument();
    });

    it("keeps rendering the loaded rows alongside the error banner", () => {
      const items = [
        makePaymentRecord({ id: "op-0", isReceived: true }),
        makePaymentRecord({ id: "op-1", isReceived: false }),
      ];
      mockHookReturn({
        items: items as any[],
        loading: false,
        error: new Error("Failed to load more"),
        hasMore: true,
      });

      render(React.createElement(TransactionList));

      // The banner path must not replace the already-loaded page of results.
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("calls refresh when the error banner retry button is clicked", () => {
      const refresh = jest.fn().mockResolvedValue(undefined);
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({
        items: items as any[],
        loading: false,
        error: new Error("Failed to load more"),
        hasMore: true,
        refresh,
      });

      render(React.createElement(TransactionList));

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic message when the error carries no message", () => {
      mockHookReturn({
        items: [],
        loading: false,
        error: new Error(""),
        hasMore: false,
      });

      render(React.createElement(TransactionList));

      expect(
        screen.getByText(/an unexpected error occurred/i),
      ).toBeInTheDocument();
    });

    it("falls back to a generic banner message when the error carries no message", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({
        items: items as any[],
        loading: false,
        error: new Error(""),
        hasMore: true,
      });

      render(React.createElement(TransactionList));

      expect(
        screen.getByText(/failed to load more transactions/i),
      ).toBeInTheDocument();
    });

    it('exposes the error state to assistive technology via role="alert"', () => {
      mockHookReturn({
        items: [],
        loading: false,
        error: new Error("Network error"),
        hasMore: false,
      });

      render(React.createElement(TransactionList));

      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  // ── 7. Load-more guard ──────────────────────────────────────────────────

  describe("load-more guard", () => {
    it("does not call fetchNextPage while a fetch is already in flight", () => {
      const fetchNextPage = jest.fn().mockResolvedValue(undefined);
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({
        items: items as any[],
        hasMore: true,
        loading: true,
        fetchNextPage,
      });

      render(React.createElement(TransactionList));

      // The button is disabled, but the handler also guards on `loading` so a
      // programmatic click must stay a no-op.
      fireEvent.click(screen.getByRole("button", { name: /loading more/i }));

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it("renders every accumulated page of results", () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makePaymentRecord({ id: `op-${i}`, isReceived: i % 2 === 0 }),
      );
      mockHookReturn({
        items: items as any[],
        hasMore: false,
        loading: false,
      });

      render(React.createElement(TransactionList));

      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      expect(
        screen.queryByRole("button", { name: /load more/i }),
      ).not.toBeInTheDocument();
    });

    it("labels the transaction list for assistive technology", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[], hasMore: false, loading: false });

      render(React.createElement(TransactionList));

      expect(
        screen.getByRole("list", { name: /transaction history/i }),
      ).toBeInTheDocument();
    });
  });
});
