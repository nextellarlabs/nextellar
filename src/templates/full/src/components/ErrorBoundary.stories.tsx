import type { Meta, StoryObj } from '@storybook/react';
import ErrorBoundary from './ErrorBoundary';

/** Throws during render so ErrorBoundary's fallback UI is what gets shown. */
function ThrowingChild(): never {
  throw new Error('Simulated render error for the ErrorBoundary story');
}

const meta = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Normal case — no error, children render through untouched. */
export const NoError: Story = {
  args: {
    children: (
      <div className="p-10 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          Everything is fine — this is the app rendering normally.
        </p>
      </div>
    ),
  },
};

/**
 * A child throws during render — ErrorBoundary catches it and shows its
 * fallback UI (Try Again / Show Details).
 */
export const CaughtError: Story = {
  args: {
    children: <ThrowingChild />,
  },
};
