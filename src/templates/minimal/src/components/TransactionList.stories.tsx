import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext, WalletConfigContext } from '../contexts/WalletProvider';
import TransactionList, { TransactionListContent } from './TransactionList';
import type { OperationItem } from '../hooks/useTransactionHistory';

// ── Mock wallet contexts ───────────────────────────────────────────────────────
// TransactionList doesn't need a live WalletProvider, just its context shape.
const mockWalletContext = {
  connected: false,
  publicKey: undefined,
  walletName: undefined,
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  switchAccount: async () => {},
  sendPayment: undefined,
};

const mockConfigContext = {
  activeNetworkKey: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanUrl: 'https://soroban-testnet.stellar.org',
  network: 'Test SDF Network ; September 2015',
  switchNetwork: () => {},
};

const withMockContexts =
  (walletOverrides = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletConfigContext.Provider value={mockConfigContext}>
        <WalletContext.Provider value={{ ...mockWalletContext, ...walletOverrides }}>
          <Story />
        </WalletContext.Provider>
      </WalletConfigContext.Provider>
    );

// ── Sample transaction data (used by the state stories below) ──────────────────

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234';
const OTHER = 'GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD';

function makeTx(
  index: number,
  overrides: Partial<OperationItem> = {},
): OperationItem {
  const received = index % 2 === 0;
  return {
    id: `op-${index}`,
    type: 'payment',
    type_i: 1,
    created_at: new Date(Date.now() - index * 3_600_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: received ? OTHER : WALLET,
    paging_token: `pt-${index}`,
    amount: `${(100 + index).toFixed(7)}`,
    asset_type: 'native',
    from: received ? OTHER : WALLET,
    to: received ? WALLET : OTHER,
    transaction_successful: true,
    ...overrides,
  } as OperationItem;
}

const MOCK_ITEMS = Array.from({ length: 5 }, (_, i) => makeTx(i));

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Components/TransactionList',
  component: TransactionList,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  argTypes: {
    limit: {
      control: { type: 'number' },
      description: 'Transactions requested per page (pageSize).',
    },
    type: {
      control: { type: 'select' },
      options: [undefined, 'payments', 'operations'],
      description: "Fetch 'payments' or 'operations'.",
    },
  },
} satisfies Meta<typeof TransactionList>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Container-driven stories (real hook, no network) ───────────────────────────

/**
 * No wallet connected — the component's underlying hook never fetches
 * without a public key, so this renders the empty state with zero network
 * calls, safe to preview standalone. `limit`/`type` are exposed as controls
 * and are forwarded to `useTransactionHistory`.
 */
export const Disconnected: Story = {
  args: { limit: 10, type: undefined },
  decorators: [withMockContexts()],
};

// ── State stories (mock data, no network) ─────────────────────────────────────

/** Initial load — four skeleton rows with an announced loading state. */
export const Loading: Story = {
  render: () => (
    <TransactionListContent
      items={[]}
      loading
      error={null}
      hasMore={false}
      walletAddress={WALLET}
    />
  ),
};

/** No transactions yet for a connected wallet. */
export const Empty: Story = {
  render: () => (
    <TransactionListContent
      items={[]}
      loading={false}
      error={null}
      hasMore={false}
      walletAddress={WALLET}
      connected
    />
  ),
};

/** Fatal error before any rows loaded, with a retry affordance. */
export const Error: Story = {
  render: () => (
    <TransactionListContent
      items={[]}
      loading={false}
      error={new Error('Failed to reach Horizon testnet')}
      hasMore={false}
      walletAddress={WALLET}
      onRetry={() => {}}
    />
  ),
};

/** A page of results with more available (Load More button). */
export const Paginated: Story = {
  render: () => (
    <TransactionListContent
      items={MOCK_ITEMS}
      loading={false}
      error={null}
      hasMore
      walletAddress={WALLET}
      connected
      onLoadMore={() => {}}
    />
  ),
};

/** Load-more in flight — the button shows a spinner and is disabled. */
export const LoadingMore: Story = {
  render: () => (
    <TransactionListContent
      items={MOCK_ITEMS}
      loading
      error={null}
      hasMore
      walletAddress={WALLET}
      connected
      onLoadMore={() => {}}
    />
  ),
};

/** Rows already loaded but the next page failed — inline error banner. */
export const ErrorBanner: Story = {
  render: () => (
    <TransactionListContent
      items={MOCK_ITEMS}
      loading={false}
      error={new Error('Failed to load more transactions')}
      hasMore
      walletAddress={WALLET}
      connected
      onRetry={() => {}}
    />
  ),
};

/** A failed transaction is badged inline and conveyed to screen readers. */
export const FailedRow: Story = {
  render: () => (
    <TransactionListContent
      items={[
        makeTx(0, { transaction_successful: false }),
        makeTx(1),
      ]}
      loading={false}
      error={null}
      hasMore={false}
      walletAddress={WALLET}
      connected
    />
  ),
};

/** Many accumulated pages — every loaded row is rendered. */
export const ManyRows: Story = {
  render: () => (
    <TransactionListContent
      items={Array.from({ length: 20 }, (_, i) => makeTx(i))}
      loading={false}
      error={null}
      hasMore={false}
      walletAddress={WALLET}
      connected
    />
  ),
};
