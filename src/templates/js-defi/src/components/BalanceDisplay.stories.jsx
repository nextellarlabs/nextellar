import React from "react";
import { WalletContext } from "../contexts/WalletProvider";
import BalanceDisplay from "./BalanceDisplay";

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

/** @type { import('@storybook/react').Meta<typeof BalanceDisplay> } */
const meta = {
  title: "Components/BalanceDisplay",
  component: BalanceDisplay,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Disconnected = {
  decorators: [withMockWallet()],
};

/**
 * Connected: renders the real component against a mocked wallet context.
 * useStellarBalances still makes a real Horizon call in Storybook (no
 * network mocking layer here), so this shows the loading/error path rather
 * than populated balances unless a live testnet account is used.
 */
export const Connected = {
  decorators: [
    withMockWallet({
      connected: true,
      publicKey: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
    }),
  ],
};
