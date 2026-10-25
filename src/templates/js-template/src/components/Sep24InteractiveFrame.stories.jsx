import React from "react";
import Sep24InteractiveFrame from "./Sep24InteractiveFrame";

/** @type { import('@storybook/react').Meta<typeof Sep24InteractiveFrame> } */
const meta = {
  title: "Components/Sep24InteractiveFrame",
  component: Sep24InteractiveFrame,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Default = {
  args: {
    url: "https://anchor.example.com/sep24/interactive?token=demo",
    transactionId: "3b4b9b5e-8c2a-4f1a-9e0a-7c6d1a2b3c4d",
    onClose: () => {},
  },
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const WithoutCloseButton = {
  args: {
    url: "https://anchor.example.com/sep24/interactive?token=demo",
    transactionId: "3b4b9b5e-8c2a-4f1a-9e0a-7c6d1a2b3c4d",
  },
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const NoUrl = {
  // Renders nothing: demonstrates the frame staying hidden until the
  // interactive endpoint has actually returned a url.
  args: {
    url: undefined,
  },
};
