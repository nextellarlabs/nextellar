import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext, WalletConfigContext } from '../contexts/WalletProvider';
import TransactionList from './TransactionList';

// Same pattern as WalletConnectButton.stories.tsx / NetworkSwitcher.stories.tsx —
// TransactionList doesn't need a live WalletProvider, just its context shape.
const mockWalletContext = {
  connected: false,
  publicKey: undefined,
  walletName: undefined,
  balances: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
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

const meta = {
  title: 'Components/TransactionList',
  component: TransactionList,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof TransactionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * No wallet connected — the component's underlying hook never fetches
 * without a public key, so this renders the empty state with zero network
 * calls, safe to preview standalone.
 *
 * NOTE: the connected/loaded/error states depend on a real Horizon
 * response (via `useTransactionHistory`'s live fetch) and aren't
 * demoable here without a mock network layer (e.g. MSW) — none exists
 * in this template yet. This story documents the one state reachable
 * without one.
 */
export const Disconnected: Story = {
  decorators: [withMockContexts()],
};
