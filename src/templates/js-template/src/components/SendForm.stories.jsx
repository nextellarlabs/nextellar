import React from "react";
import { WalletContext } from "../contexts/WalletProvider";
import SendForm from "./SendForm";

const VALID_ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

const mockWalletContext = {
  connected: true,
  publicKey: VALID_ADDRESS,
  walletName: "Freighter",
  balances: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: async () => ({}),
};

const withMockWallet =
  (overrides = {}) =>
  (Story) =>
    (
      <WalletContext.Provider value={{ ...mockWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

/** @type { import('@storybook/react').Meta<typeof SendForm> } */
const meta = {
  title: "Components/SendForm",
  component: SendForm,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
};

export default meta;

/** No wallet connected — every field is disabled and the submit button stays off. */
export const Disconnected = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
};

/** Idle — connected, empty form, no validation errors yet. */
export const Idle = {
  decorators: [withMockWallet()],
};

/** Connected to an adapter that cannot send payments — submit stays disabled. */
export const Unsupported = {
  decorators: [withMockWallet({ sendPayment: undefined })],
};

/**
 * Validation error — an invalid address and a non-positive amount are typed
 * in, so both inline error messages render and submit stays disabled.
 */
export const ValidationError = {
  decorators: [withMockWallet()],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import("@storybook/test");
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To"), "not-a-valid-address");
    await userEvent.type(canvas.getByLabelText("Amount (XLM)"), "-5");
  },
};

/** Submitting — sendPayment never resolves, so the form stays pending. */
export const Submitting = {
  decorators: [
    withMockWallet({
      sendPayment: () => new Promise(() => {}),
    }),
  ],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import("@storybook/test");
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To"), VALID_ADDRESS);
    await userEvent.type(canvas.getByLabelText("Amount (XLM)"), "10");
    await userEvent.click(canvas.getByRole("button", { name: /send/i }));
  },
};

/** Success — sendPayment resolves and the form clears with a "Sent" badge. */
export const Success = {
  decorators: [withMockWallet()],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import("@storybook/test");
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To"), VALID_ADDRESS);
    await userEvent.type(canvas.getByLabelText("Amount (XLM)"), "10");
    await userEvent.click(canvas.getByRole("button", { name: /send/i }));
  },
};

/** Error — sendPayment rejects and the failure message is surfaced. */
export const Failed = {
  decorators: [
    withMockWallet({
      sendPayment: async () => {
        throw new Error("Insufficient balance");
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import("@storybook/test");
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("To"), VALID_ADDRESS);
    await userEvent.type(canvas.getByLabelText("Amount (XLM)"), "10");
    await userEvent.click(canvas.getByRole("button", { name: /send/i }));
  },
};
