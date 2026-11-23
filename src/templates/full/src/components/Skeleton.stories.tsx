import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default placeholder — full width, a single line of text height. */
export const Default: Story = {};

/** A line of text at a fixed width. */
export const TextLine: Story = {
  args: { width: 'w-28' },
};

/** A circular avatar placeholder. */
export const Avatar: Story = {
  args: { width: 'w-10', height: 'h-10', className: 'rounded-full' },
};
