import React from "react";
import { WalletContext } from "../contexts/WalletProvider";
import WalletConnectButton from "./WalletConnectButton";

const mockWalletContext = {
  connected: false,
  publicKey: undefined,
  walletName: undefined,
  balances: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: undefined,
};

const withMockWallet =
  (overrides = {}) =>
  (Story) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

/** @type { import('@storybook/react').Meta<typeof WalletConnectButton> } */
const meta = {
  title: "Components/WalletConnectButton",
  component: WalletConnectButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const LightDisconnected = {
  args: { theme: "light" },
  decorators: [withMockWallet()],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const DarkDisconnected = {
  args: { theme: "dark" },
  parameters: { backgrounds: { default: "dark" } },
  decorators: [withMockWallet()],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Connected = {
  args: { theme: "light" },
  decorators: [withMockWallet({ connected: true, walletName: "Freighter" })],
};
