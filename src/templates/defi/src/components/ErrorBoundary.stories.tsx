import type { Meta, StoryObj } from "@storybook/react";
import ErrorBoundary from "./ErrorBoundary";

function ThrowingChild(): never {
  throw new Error("Simulated render error for the ErrorBoundary story");
}

const meta = {
  title: "Components/ErrorBoundary",
  component: ErrorBoundary,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

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

export const CaughtError: Story = {
  args: {
    children: <ThrowingChild />,
  },
};
