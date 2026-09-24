import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import ReceiveForm from './ReceiveForm';

const baseWalletContext = {
  connected: true,
  publicKey: 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ',
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
  title: 'Components/ReceiveForm',
  component: ReceiveForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof ReceiveForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No wallet connected — shows the connect-a-wallet prompt instead of an address. */
export const Disconnected: Story = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
};

/** Connected — renders the address with a working copy button. */
export const Connected: Story = {
  decorators: [withMockWallet()],
};
