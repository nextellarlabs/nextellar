import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext, WalletConfigContext } from '../contexts/WalletProvider';
import { NetworkMismatchBanner } from './NetworkMismatchBanner';

const baseWalletContext = {
  connected: true,
  publicKey: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  switchAccount: async () => {},
  sendPayment: undefined,
  walletNetworkPassphrase: undefined as string | undefined,
  networkMismatch: false,
};

const baseWalletConfig = {
  activeNetworkKey: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanUrl: 'https://soroban-testnet.stellar.org',
  network: 'Test SDF Network ; September 2015',
  switchNetwork: () => {},
};

const withMockWallet =
  (walletOverrides: Record<string, unknown> = {}, configOverrides: Record<string, unknown> = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletConfigContext.Provider value={{ ...baseWalletConfig, ...configOverrides }}>
        <WalletContext.Provider value={{ ...baseWalletContext, ...walletOverrides }}>
          <Story />
        </WalletContext.Provider>
      </WalletConfigContext.Provider>
    );

const meta = {
  title: 'Components/NetworkMismatchBanner',
  component: NetworkMismatchBanner,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof NetworkMismatchBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Networks agree — renders nothing (null). */
export const NoMismatch: Story = {
  decorators: [
    withMockWallet({
      walletNetworkPassphrase: 'Test SDF Network ; September 2015',
      networkMismatch: false,
    }),
  ],
};

/** Wallet reports mainnet while the app is configured for testnet. */
export const MismatchTestnetApp: Story = {
  decorators: [
    withMockWallet({
      walletNetworkPassphrase: 'Public Global Stellar Network ; September 2015',
      networkMismatch: true,
    }),
  ],
};

/** Wallet reports testnet while the app is configured for mainnet. */
export const MismatchMainnetApp: Story = {
  decorators: [
    withMockWallet(
      {
        walletNetworkPassphrase: 'Test SDF Network ; September 2015',
        networkMismatch: true,
      },
      {
        activeNetworkKey: 'mainnet',
        network: 'Public Global Stellar Network ; September 2015',
      },
    ),
  ],
};
