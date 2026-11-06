import React from 'react';
import TransactionStatusBadge from './TransactionStatusBadge';

const meta = {
  title: 'Components/TransactionStatusBadge',
  component: TransactionStatusBadge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;

/** Pending, animated spinner (default). */
export const Pending = {
  args: { status: 'pending' },
};

/** Pending with a static clock icon instead of a spinner. */
export const PendingStatic = {
  args: { status: 'pending', showSpinner: false },
};

/** Successful transaction. */
export const Success = {
  args: { status: 'success' },
};

/** Failed transaction. */
export const Failed = {
  args: { status: 'failed' },
};

/** Custom label overriding the default status text. */
export const CustomLabel = {
  args: { status: 'pending', label: 'Awaiting signature' },
};

/** All three states side by side. */
export const AllStates = {
  render: () => (
    <div className="flex items-center gap-2">
      <TransactionStatusBadge status="pending" />
      <TransactionStatusBadge status="success" />
      <TransactionStatusBadge status="failed" />
    </div>
  ),
};
