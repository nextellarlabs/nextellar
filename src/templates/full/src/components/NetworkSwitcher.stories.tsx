import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext, WalletConfigContext } from '../contexts/WalletProvider';
import { NETWORKS } from '../config/networks';
import NetworkSwitcher from './NetworkSwitcher';

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
  networks: NETWORKS,
  addCustomNetwork: () => {},
  removeCustomNetwork: () => {},
};

const withMockContexts =
  (configOverrides = {}, walletOverrides = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletConfigContext.Provider value={{ ...mockConfigContext, ...configOverrides }}>
        <WalletContext.Provider value={{ ...mockWalletContext, ...walletOverrides }}>
          <Story />
        </WalletContext.Provider>
      </WalletConfigContext.Provider>
    );

const meta = {
  title: 'Components/NetworkSwitcher',
  component: NetworkSwitcher,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof NetworkSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Network switcher on Testnet (default) */
export const Testnet: Story = {
  decorators: [withMockContexts()],
};

/** Network switcher on Mainnet */
export const Mainnet: Story = {
  decorators: [withMockContexts({ activeNetworkKey: 'mainnet' })],
};

/** Wallet already connected — switching network will warn user */
export const ConnectedWallet: Story = {
  decorators: [
    withMockContexts({}, { connected: true, walletName: 'Freighter', publicKey: 'GABC...XYZ' }),
  ],
};

/** A previously-added custom network appears alongside the built-in presets */
export const WithCustomNetwork: Story = {
  decorators: [
    withMockContexts({
      networks: {
        ...NETWORKS,
        futurenet: {
          name: 'Futurenet',
          horizonUrl: 'https://horizon-futurenet.stellar.org',
          sorobanUrl: 'https://rpc-futurenet.stellar.org',
          passphrase: 'Test SDF Future Network ; October 2022',
          isCustom: true,
        },
      },
    }),
  ],
};
