import React from "react";
import { Networks } from "@stellar/stellar-sdk";
import { WalletContext, WalletConfigContext } from "../contexts/WalletProvider";
import NetworkMismatchBanner from "./NetworkMismatchBanner";

const mockWalletContext = {
  connected: true,
  publicKey: "GABC...MOCK",
  walletName: "Freighter",
  balances: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: undefined,
};

const mockConfigContext = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  network: Networks.TESTNET,
  sorobanUrl: "https://soroban-testnet.stellar.org",
};

const withMockWallet =
  (walletOverrides = {}, configOverrides = {}) =>
  (Story) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...walletOverrides }}>
        <WalletConfigContext.Provider value={{ ...mockConfigContext, ...configOverrides }}>
          <Story />
        </WalletConfigContext.Provider>
      </WalletContext.Provider>
    );

/** @type { import('@storybook/react').Meta<typeof NetworkMismatchBanner> } */
const meta = {
  title: "Components/NetworkMismatchBanner",
  component: NetworkMismatchBanner,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
};

export default meta;

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const WalletOnMainnetAppOnTestnet = {
  args: { walletNetworkPassphrase: Networks.PUBLIC },
  decorators: [withMockWallet()],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const WalletOnTestnetAppOnMainnet = {
  args: { walletNetworkPassphrase: Networks.TESTNET },
  decorators: [withMockWallet({}, { network: Networks.PUBLIC })],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const NoMismatch = {
  args: { walletNetworkPassphrase: Networks.TESTNET },
  decorators: [withMockWallet()],
};

/** @type { import('@storybook/react').StoryObj<typeof meta> } */
export const Disconnected = {
  args: { walletNetworkPassphrase: Networks.PUBLIC },
  decorators: [withMockWallet({ connected: false })],
};
