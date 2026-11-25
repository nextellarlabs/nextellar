import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import AccountSwitcher from './AccountSwitcher';

const baseWalletContext = {
  connected: true,
  publicKey: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: undefined,
  currentAccountIndex: 0,
  switchAccount: async () => {},
};

const withMockWallet =
  (overrides: Record<string, unknown> = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletContext.Provider value={{ ...baseWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

const meta = {
  title: 'Components/AccountSwitcher',
  component: AccountSwitcher,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof AccountSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Not connected — renders nothing (null), matching the component's guard clause. */
export const Disconnected: Story = {
  decorators: [withMockWallet({ connected: false, accounts: [] })],
};

/** Single connected account. */
export const OneAccount: Story = {
  decorators: [
    withMockWallet({
      accounts: [
        {
          address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
          displayName: 'Main Wallet',
        },
      ],
    }),
  ],
};

/** Multiple accounts — click the button to open the dropdown and switch. */
export const MultipleAccounts: Story = {
  decorators: [
    withMockWallet({
      accounts: [
        {
          address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12',
          displayName: 'Main Wallet',
        },
        {
          address: 'GXYZ9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA98',
          displayName: 'Savings',
        },
        {
          address: 'GDEF5555555555555555555555555555555555555555555555555',
        },
      ],
    }),
  ],
};
