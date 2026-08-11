import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import WalletConnectButton from './WalletConnectButton';

// Provide a minimal mock of WalletContext so the story works without
// a live WalletProvider (which depends on browser localStorage, etc.)
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

const withMockWallet =
  (overrides = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

const meta = {
  title: 'Components/WalletConnectButton',
  component: WalletConnectButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof WalletConnectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default disconnected state — light theme */
export const LightDisconnected: Story = {
  args: { theme: 'light' },
  decorators: [withMockWallet()],
};

/** Disconnected state — dark background */
export const DarkDisconnected: Story = {
  args: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
  decorators: [withMockWallet()],
};

/** Connected state — shows wallet name in button */
export const Connected: Story = {
  args: { theme: 'light' },
  decorators: [
    withMockWallet({ connected: true, walletName: 'Freighter' }),
  ],
};
