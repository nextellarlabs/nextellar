import type { Meta, StoryObj } from "@storybook/react";
import CounterDemo from "./CounterDemo";

const meta = {
  title: "Components/CounterDemo",
  component: CounterDemo,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof CounterDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
