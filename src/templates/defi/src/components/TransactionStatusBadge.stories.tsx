import type { Meta, StoryObj } from '@storybook/react';
import TransactionStatusBadge from './TransactionStatusBadge';

const meta = {
  title: 'Components/TransactionStatusBadge',
  component: TransactionStatusBadge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof TransactionStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pending, animated spinner (default). */
export const Pending: Story = {
  args: { status: 'pending' },
};

/** Pending with a static clock icon instead of a spinner. */
export const PendingStatic: Story = {
  args: { status: 'pending', showSpinner: false },
};

/** Successful transaction. */
export const Success: Story = {
  args: { status: 'success' },
};

/** Failed transaction. */
export const Failed: Story = {
  args: { status: 'failed' },
};

/** Custom label overriding the default status text. */
export const CustomLabel: Story = {
  args: { status: 'pending', label: 'Awaiting signature' },
};

/** All three states side by side. */
export const AllStates: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <TransactionStatusBadge status="pending" />
      <TransactionStatusBadge status="success" />
      <TransactionStatusBadge status="failed" />
    </div>
  ),
};
