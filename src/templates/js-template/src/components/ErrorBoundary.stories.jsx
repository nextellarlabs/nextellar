import React from "react";
import ErrorBoundary from "./ErrorBoundary";

function ThrowingChild() {
  throw new Error("Simulated render error for the ErrorBoundary story");
}

/** @type { import('@storybook/react').Meta<typeof ErrorBoundary> } */
const meta = {
  title: "Components/ErrorBoundary",
  component: ErrorBoundary,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const NoError = {
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

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const CaughtError = {
  args: {
    children: <ThrowingChild />,
  },
};
