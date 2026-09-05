import ErrorBoundary from "./ErrorBoundary";

function ThrowingChild() {
  throw new Error("Simulated render error for the ErrorBoundary story");
}

const meta = {
  title: "Components/ErrorBoundary",
  component: ErrorBoundary,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
};

export default meta;

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

export const CaughtError = {
  args: {
    children: <ThrowingChild />,
  },
};
