import type { Meta, StoryObj } from '@storybook/react';
import { SkeletonList } from './Skeleton';

const meta = {
  title: 'Components/SkeletonList',
  component: SkeletonList,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof SkeletonList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default loading list — 4 rows, generic row shape. */
export const Default: Story = {};

/** Fewer rows, for a shorter list view. */
export const TwoRows: Story = {
  args: { rows: 2 },
};

/** Custom announced label for screen readers. */
export const CustomLabel: Story = {
  args: { rows: 3, label: 'Loading transaction history' },
};
