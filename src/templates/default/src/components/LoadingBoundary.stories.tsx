import type { Meta, StoryObj } from '@storybook/react';
import LoadingBoundary from './LoadingBoundary';

/** Never resolves, so React keeps showing the Suspense fallback — lets the
 * story demonstrate the loading state without a real async data source. */
function SuspendsForever(): never {
  throw new Promise(() => {});
}

const meta = {
  title: 'Components/LoadingBoundary',
  component: LoadingBoundary,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
} satisfies Meta<typeof LoadingBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resolved case — children render normally once loaded. */
export const Resolved: Story = {
  args: {
    children: (
      <div className="p-4 text-gray-600 dark:text-gray-400">
        Content has loaded.
      </div>
    ),
  },
};

/** Loading fallback — default SkeletonList, 4 rows. */
export const Loading: Story = {
  args: {
    label: 'Loading balances',
    children: <SuspendsForever />,
  },
};

/** Loading fallback with a smaller row count. */
export const LoadingFewRows: Story = {
  args: {
    label: 'Loading recent activity',
    rows: 2,
    children: <SuspendsForever />,
  },
};

/** Loading with a fully custom fallback instead of the default skeleton. */
export const CustomFallback: Story = {
  args: {
    fallback: (
      <div className="p-4 text-center text-sm text-gray-500">
        Fetching from Horizon…
      </div>
    ),
    children: <SuspendsForever />,
  },
};
