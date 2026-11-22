import type { Meta, StoryObj } from "@storybook/react";
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
  disconnect: () => {},
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
  (Story: React.ComponentType) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...walletOverrides }}>
        <WalletConfigContext.Provider value={{ ...mockConfigContext, ...configOverrides }}>
          <Story />
        </WalletConfigContext.Provider>
      </WalletContext.Provider>
    );

const meta = {
  title: "Components/NetworkMismatchBanner",
  component: NetworkMismatchBanner,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof NetworkMismatchBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** App configured for testnet, wallet reports mainnet: mismatch shown. */
export const WalletOnMainnetAppOnTestnet: Story = {
  args: { walletNetworkPassphrase: Networks.PUBLIC },
  decorators: [withMockWallet()],
};

/** App configured for mainnet, wallet reports testnet: mismatch shown. */
export const WalletOnTestnetAppOnMainnet: Story = {
  args: { walletNetworkPassphrase: Networks.TESTNET },
  decorators: [withMockWallet({}, { network: Networks.PUBLIC })],
};

/** Networks match: renders nothing. */
export const NoMismatch: Story = {
  args: { walletNetworkPassphrase: Networks.TESTNET },
  decorators: [withMockWallet()],
};

/** No wallet connected: renders nothing regardless of the passed passphrase. */
export const Disconnected: Story = {
  args: { walletNetworkPassphrase: Networks.PUBLIC },
  decorators: [withMockWallet({ connected: false })],
};
