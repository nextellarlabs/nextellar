import React from "react";
import {
  WalletContext,
  WalletConfigContext,
} from "../contexts/WalletProvider";
import NetworkSwitcher from "./NetworkSwitcher";

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

const mockConfigContext = {
  activeNetworkKey: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanUrl: "https://soroban-testnet.stellar.org",
  network: "Test SDF Network ; September 2015",
  switchNetwork: () => {},
};

const withMockContexts =
  (configOverrides = {}, walletOverrides = {}) =>
  (Story) =>
    (
      <WalletConfigContext.Provider
        value={{ ...mockConfigContext, ...configOverrides }}
      >
        <WalletContext.Provider
          value={{ ...mockWalletContext, ...walletOverrides }}
        >
          <Story />
        </WalletContext.Provider>
      </WalletConfigContext.Provider>
    );

/** @type { import('@storybook/react').Meta<typeof NetworkSwitcher> } */
const meta = {
  title: "Components/NetworkSwitcher",
  component: NetworkSwitcher,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Testnet = {
  decorators: [withMockContexts()],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Mainnet = {
  decorators: [withMockContexts({ activeNetworkKey: "mainnet" })],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const ConnectedWallet = {
  decorators: [
    withMockContexts(
      {},
      { connected: true, walletName: "Freighter", publicKey: "GABC...XYZ" }
    ),
  ],
};
