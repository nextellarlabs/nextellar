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
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  connectedWallet,
  createTransactionHistoryState,
  disconnectedWallet,
  makeNonPaymentRecord,
  makePaymentRecord,
  COUNTERPARTY_PUBLIC_KEY as OTHER_ADDRESS,
  type HorizonOperationRecord,
} from "../helpers";

// ── Mock useTransactionHistory hook ───────────────────────────────────────────
await jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useTransactionHistory",
  () => ({
    useTransactionHistory: jest.fn(),
  }),
);

// ── Dynamic imports (must be after unstable_mockModule) ───────────────────────
const [{ default: TransactionList }, { useTransactionHistory }] =
  await Promise.all([
    import("../../src/templates/default/src/components/TransactionList"),
    import("../../src/templates/default/src/hooks/useTransactionHistory"),
  ]);

type TransactionListProps = {
  limit?: number;
  type?: "payments" | "operations";
};

function mockHookReturn(
  partial: Partial<{
    items: HorizonOperationRecord[];
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    fetchNextPage: () => Promise<void>;
    refresh: () => Promise<void>;
  }>,
) {
  (useTransactionHistory as jest.Mock).mockReturnValue(
    createTransactionHistoryState({
      fetchNextPage: jest
        .fn()
        .mockResolvedValue(undefined) as () => Promise<void>,
      refresh: jest.fn().mockResolvedValue(undefined) as () => Promise<void>,
      ...partial,
    }),
  );
}

function renderList(props?: TransactionListProps, wallet = connectedWallet()) {
  return render(React.createElement(TransactionList, props), { wallet });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionList Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Direction ────────────────────────────────────────────────────────

  describe("direction indicators", () => {
    it("renders a received transaction with incoming indicator", () => {
      const receivedTx = makePaymentRecord({ isReceived: true });
      mockHookReturn({ items: [receivedTx as any] });

      renderList();
      expect(screen.getByLabelText("Received")).toBeInTheDocument();
    });

    it("renders a sent transaction with outgoing indicator", () => {
      const sentTx = makePaymentRecord({ isReceived: false });
      mockHookReturn({ items: [sentTx as any] });

      renderList();
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

      renderList();
      expect(
        screen.getByRole("button", { name: /load more/i }),
      ).toBeInTheDocument();
    });

    it('does NOT render "Load More" button when hasMore is false', () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[], hasMore: false, loading: false });

      renderList();
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

      renderList();

      const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(fetchNextPage).toHaveBeenCalledTimes(1);
      });
    });

    it('shows loading state on the "Load More" button while fetching', () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[], hasMore: true, loading: true });

      renderList();

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

      renderList();
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
    });

    it("renders a connect-wallet message when wallet is not connected", () => {
      mockHookReturn({ items: [], loading: false, hasMore: false });

      renderList({}, disconnectedWallet());
      expect(screen.getByText(/connect wallet/i)).toBeInTheDocument();
    });
  });

  // ── 4. Loading state ────────────────────────────────────────────────────

  describe("loading state", () => {
    it("renders 4 skeleton rows when initially loading", () => {
      mockHookReturn({ items: [], loading: true, hasMore: false });

      renderList();

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

      renderList();

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 10 }),
      );
    });

    it("passes a custom limit to useTransactionHistory", () => {
      mockHookReturn({ items: [], loading: false });

      renderList({ limit: 25 });

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 25 }),
      );
    });

    it('passes type="payments" to useTransactionHistory', () => {
      mockHookReturn({ items: [], loading: false });

      renderList({ type: "payments" });

      expect(useTransactionHistory).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: "payments" }),
      );
    });

    it('passes type="operations" to useTransactionHistory', () => {
      mockHookReturn({ items: [], loading: false });

      renderList({ type: "operations" });

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

      renderList();

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

      renderList();

      // The amount should appear with + prefix for received
      expect(screen.getByText(/^\+/)).toBeInTheDocument();
      // XLM asset should be visible
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    it("displays non-payment representation for operations without amounts", () => {
      const items = [makeNonPaymentRecord({ id: "op-0" })];
      mockHookReturn({ items: items as any[] });

      renderList();

      // For non-payment ops, the type name appears in both the
      // type label and the amount slot (two times)
      expect(screen.getAllByText("Create Account")).toHaveLength(2);
    });

    it("truncates a long address", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[] });

      renderList();

      // The counterparty OTHER_ADDRESS should be truncated
      const truncated =
        OTHER_ADDRESS.slice(0, 4) + "..." + OTHER_ADDRESS.slice(-4);
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it("displays relative time for a transaction", () => {
      const items = [makePaymentRecord({ id: "op-0", isReceived: true })];
      mockHookReturn({ items: items as any[] });

      renderList();

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

      renderList();

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

      renderList();

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

      renderList();

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

      renderList();

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

      renderList();

      // Error banner should be visible along with items
      expect(screen.getByText(/failed to load more/i)).toBeInTheDocument();
    });
  });
});
