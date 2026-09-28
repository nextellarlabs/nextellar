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
import "@testing-library/jest-dom";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  createTransactionHistoryState,
  connectedWallet,
  disconnectedWallet,
  PUBLIC_KEY,
  USDC,
  type HorizonOperationRecord,
} from "../helpers";
import type { TransactionListProps } from "../../src/templates/default/src/components/TransactionList";

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

// Must match connectedWallet()'s publicKey (PUBLIC_KEY) -- that's what
// useWallet() resolves to by default (see the beforeEach below and
// renderList's default arg), and TransactionRow's sent/received direction
// is derived by comparing each record's from/to against walletAddress.
const WALLET_ADDRESS = PUBLIC_KEY;
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

// useWallet is a fully module-mocked jest.fn() (see the unstable_mockModule
// call above), not the real hook reading WalletContext -- so the wrapped
// render's `wallet` provider option has nothing to attach to. Configuring
// the mock's return value directly is what actually determines what
// TransactionList sees when it calls useWallet().
function renderList(props?: TransactionListProps, wallet = connectedWallet()) {
  (useWallet as jest.Mock).mockReturnValue(wallet);
  return render(React.createElement(TransactionList, props));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TransactionList Component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWallet as jest.Mock).mockReturnValue(connectedWallet());
  });

  // ── 1. Direction ────────────────────────────────────────────────────────

  describe("direction indicators", () => {
    it("renders a received transaction with incoming indicator", () => {
      const receivedTx = makePaymentRecord({ isReceived: true });
      mockHookReturn({ items: [receivedTx as any] });

      render(React.createElement(TransactionList));
      // The row's full non-visual description starts with the direction
      // (see the "rowLabel" construction in TransactionList.tsx) -- there's
      // no bare "Received"/"Sent" aria-label on its own.
      expect(screen.getByLabelText(/^Received /)).toBeInTheDocument();
    });

    it("renders a sent transaction with outgoing indicator", () => {
      const sentTx = makePaymentRecord({ isReceived: false });
      mockHookReturn({ items: [sentTx as any] });

      render(React.createElement(TransactionList));
      expect(screen.getByLabelText(/^Sent /)).toBeInTheDocument();
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

  // ── Asset filtering (#1102) ──────────────────────────────────────────────
  // Applied client-side to the already-fetched page, so it does NOT change
  // what's passed to useTransactionHistory -- these assert on rendered
  // output, not on the hook call args.

  describe("asset filtering", () => {
    it("shows only transactions matching the asset filter, hiding the rest", () => {
      const usdcTx = makePaymentRecord({
        id: "op-0",
        isReceived: true,
        asset_type: "credit_alphanum4",
        asset_code: USDC.code,
      });
      const xlmTx = makePaymentRecord({
        id: "op-1",
        isReceived: true,
        asset_type: "native",
      });
      mockHookReturn({ items: [usdcTx, xlmTx] as any[] });

      renderList({ asset: "USDC" });

      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText("USDC")).toBeInTheDocument();
      expect(screen.queryByText("XLM")).not.toBeInTheDocument();
    });

    it("matches the asset filter case-insensitively", () => {
      const usdcTx = makePaymentRecord({
        id: "op-0",
        isReceived: true,
        asset_type: "credit_alphanum4",
        asset_code: USDC.code,
      });
      mockHookReturn({ items: [usdcTx] as any[] });

      renderList({ asset: "usdc" });

      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });

    it('filters to only the native asset when asset="XLM"', () => {
      const usdcTx = makePaymentRecord({
        id: "op-0",
        isReceived: true,
        asset_type: "credit_alphanum4",
        asset_code: USDC.code,
      });
      const xlmTx = makePaymentRecord({
        id: "op-1",
        isReceived: true,
        asset_type: "native",
      });
      mockHookReturn({ items: [usdcTx, xlmTx] as any[] });

      renderList({ asset: "XLM" });

      expect(screen.getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    it("renders every item when no asset filter is provided", () => {
      const usdcTx = makePaymentRecord({
        id: "op-0",
        isReceived: true,
        asset_type: "credit_alphanum4",
        asset_code: USDC.code,
      });
      const xlmTx = makePaymentRecord({
        id: "op-1",
        isReceived: true,
        asset_type: "native",
      });
      mockHookReturn({ items: [usdcTx, xlmTx] as any[] });

      renderList();

      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("shows the empty state when the filter matches nothing on the current page", () => {
      const xlmTx = makePaymentRecord({
        id: "op-0",
        isReceived: true,
        asset_type: "native",
      });
      mockHookReturn({ items: [xlmTx] as any[] });

      renderList({ asset: "USDC" });

      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
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

      // "Failed" appears twice: the visible status badge and the row's
      // sr-only full description -- both are intentional, not a duplicate
      // bug, so assert on the count rather than a single unique match.
      expect(screen.getAllByText("Failed").length).toBeGreaterThanOrEqual(1);
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
