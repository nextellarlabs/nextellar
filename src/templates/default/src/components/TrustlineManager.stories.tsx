import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import { I18nProvider } from '../contexts/I18nProvider';
import TrustlineManager from './TrustlineManager';

const DEMO_PUBLIC_KEY = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';

const baseWalletContext = {
  connected: true,
  publicKey: DEMO_PUBLIC_KEY,
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: async () => ({}) as never,
  currentAccountIndex: 0,
  switchAccount: async () => {},
};

const withProviders =
  (walletOverrides: Record<string, unknown> = {}) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) =>
    (
      <I18nProvider>
        <WalletContext.Provider value={{ ...baseWalletContext, ...walletOverrides }}>
          <Story />
        </WalletContext.Provider>
      </I18nProvider>
    );

const meta = {
  title: 'Components/TrustlineManager',
  component: TrustlineManager,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof TrustlineManager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No wallet connected — form inputs and actions are disabled with a connect prompt. */
export const Disconnected: Story = {
  decorators: [withProviders({ connected: false, publicKey: undefined })],
};

/** Connected — displays reserve summary, add-trustline form, and active trustlines list. */
export const Connected: Story = {
  decorators: [withProviders()],
};

/** Validation error — invalid asset code and issuer key keep Add Trustline disabled. */
export const ValidationError: Story = {
  decorators: [withProviders()],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Asset Code'), 'INVALID_ASSET_CODE!');
    await userEvent.type(canvas.getByLabelText('Asset Issuer'), 'not-a-valid-key');
  },
};

/** With external signing callback wired up. */
export const WithSignHandler: Story = {
  decorators: [withProviders()],
  args: {
    onSignAndSubmit: async () => ({ hash: 'mock-tx-hash' }),
  },
};
