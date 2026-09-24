import type { Meta, StoryObj } from '@storybook/react';
import EmptyState, { NoWalletIcon } from './EmptyState';

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title only — no description, no action, default inbox icon. */
export const TitleOnly: Story = {
  args: {
    title: 'No transactions yet',
  },
};

/** Title with supporting description text. */
export const WithDescription: Story = {
  args: {
    title: 'No transactions yet',
    description: 'Your transaction history will appear here',
  },
};

/** Wallet-not-connected flavor, using the built-in NoWalletIcon preset. */
export const WalletNotConnected: Story = {
  args: {
    icon: <NoWalletIcon />,
    title: 'Connect wallet to view transactions',
  },
};

/** With a call-to-action rendered below the description. */
export const WithAction: Story = {
  args: {
    icon: <NoWalletIcon />,
    title: 'Connect wallet to view balances',
    description: 'Your XLM and asset balances will appear here once connected.',
    action: (
      <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">
        Connect Wallet
      </button>
    ),
  },
};
