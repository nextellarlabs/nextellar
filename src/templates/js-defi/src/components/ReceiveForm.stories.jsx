import React from "react";
import { WalletContext } from "../contexts/WalletProvider";
import ReceiveForm from "./ReceiveForm";

const mockWalletContext = {
  connected: true,
  publicKey: "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ",
  walletName: "Freighter",
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

/** @type { import('@storybook/react').Meta<typeof ReceiveForm> } */
const meta = {
  title: "Components/ReceiveForm",
  component: ReceiveForm,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
};

export default meta;

/** No wallet connected — shows the connect-a-wallet prompt instead of an address. */
export const Disconnected = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
};

/** Connected — renders the address with a working copy button. */
export const Connected = {
  decorators: [withMockWallet()],
};
