import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import SendForm from './SendForm';

const baseWalletContext = {
  connected: true,
  publicKey: 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ',
  walletName: 'Freighter',
  balances: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: async () => ({}) as never,
};

const withMockWallet =
  (overrides: Record<string, unknown> = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <WalletContext.Provider value={{ ...baseWalletContext, ...overrides }}>
        <Story />
      </WalletContext.Provider>
    );

const meta = {
  title: 'Components/SendForm',
  component: SendForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof SendForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No wallet connected — every field is disabled and the submit button stays off. */
export const Disconnected: Story = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
};

/** Idle — connected, empty form, no validation errors yet. */
export const Idle: Story = {
  decorators: [withMockWallet()],
};

/**
 * Validation error — type an invalid address or a non-positive amount into
 * the story's live controls to see the inline error messages; the submit
 * button stays disabled until both fields are valid.
 */
export const ValidationError: Story = {
  decorators: [withMockWallet()],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('To'), 'not-a-valid-address');
    await userEvent.type(canvas.getByLabelText('Amount (XLM)'), '-5');
  },
};

/** Submitting — sendPayment never resolves, so the form stays in its pending state. */
export const Submitting: Story = {
  decorators: [
    withMockWallet({
      sendPayment: () => new Promise(() => {}),
    }),
  ],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText('To'),
      'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ',
    );
    await userEvent.type(canvas.getByLabelText('Amount (XLM)'), '10');
    await userEvent.click(canvas.getByRole('button', { name: /send/i }));
  },
};

/** Success — sendPayment resolves and the form clears with a "Sent" badge. */
export const Success: Story = {
  decorators: [
    withMockWallet({
      sendPayment: async () => ({}) as never,
    }),
  ],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText('To'),
      'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ',
    );
    await userEvent.type(canvas.getByLabelText('Amount (XLM)'), '10');
    await userEvent.click(canvas.getByRole('button', { name: /send/i }));
  },
};
