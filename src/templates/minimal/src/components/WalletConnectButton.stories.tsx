import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { WalletContext } from "../contexts/WalletProvider";
import WalletConnectButton from "./WalletConnectButton";

const mockWalletContext = {
  connected: false,
  publicKey: undefined,
  walletName: undefined,
  balances: [],
  connect: async () => {},
  disconnect: () => {},
  refreshBalances: async () => {},
  sendPayment: undefined,
};

const withMockWallet =
  (overrides = {}) =>
  (Story: React.ComponentType) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

const meta = {
  title: "Components/WalletConnectButton",
  component: WalletConnectButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof WalletConnectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LightDisconnected: Story = {
  args: { theme: "light" },
  decorators: [withMockWallet()],
};

export const DarkDisconnected: Story = {
  args: { theme: "dark" },
  parameters: { backgrounds: { default: "dark" } },
  decorators: [withMockWallet()],
};

export const Connected: Story = {
  args: { theme: "light" },
  decorators: [withMockWallet({ connected: true, walletName: "Freighter" })],
};
