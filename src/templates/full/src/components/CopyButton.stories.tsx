import type { Meta, StoryObj } from '@storybook/react';
import CopyButton from './CopyButton';

const meta = {
  title: 'Components/CopyButton',
  component: CopyButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default copy button for an address. */
export const Address: Story = {
  args: { value: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234', label: 'address' },
};

/** Copy button for a transaction hash. */
export const TransactionHash: Story = {
  args: { value: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', label: 'transaction hash' },
};

/** Larger icon size. */
export const Large: Story = {
  args: { value: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234', label: 'address', size: 18 },
};
