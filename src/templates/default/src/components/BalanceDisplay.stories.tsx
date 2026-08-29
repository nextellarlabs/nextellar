import type { Meta, StoryObj } from '@storybook/react';
import BalanceDisplay from './BalanceDisplay';

const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state. In Storybook (no real WalletProvider context), this
 * renders the "connect a wallet" empty state — the same as a real app
 * before the user connects.
 */
export const Default: Story = {};
