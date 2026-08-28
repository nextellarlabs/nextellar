import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import BalanceDisplay from './BalanceDisplay';

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const baseWalletContext = {
  connected: true,
  publicKey: ADDRESS,
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  sendPayment: undefined,
  currentAccountIndex: 0,
  switchAccount: async () => {},
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

/**
 * These stories hit the live Horizon testnet through `useStellarBalances`, so
 * the populated states depend on the account actually being funded. The
 * disconnected story is deterministic — it short-circuits before any fetch.
 */
const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [withMockWallet()],
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No wallet connected — prompts to connect instead of rendering a balance. */
export const Disconnected: Story = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
};

/** Disconnected, rendered against the dark palette. */
export const DisconnectedDark: Story = {
  decorators: [withMockWallet({ connected: false, publicKey: undefined })],
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};

/** Connected — fetches the account's balances from Horizon testnet. */
export const Connected: Story = {};

/** Connected, rendered against the dark palette. */
export const ConnectedDark: Story = {
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};

/**
 * An account that does not exist on the network yet. Horizon 404s, the hook
 * maps that to an empty balance list, and the empty state renders.
 */
export const Unfunded: Story = {
  args: { publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' },
};

/** Unfunded account against the dark palette. */
export const UnfundedDark: Story = {
  args: { publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' },
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};

/** An unreachable Horizon URL drives the error state and its retry button. */
export const ErrorState: Story = {
  args: { horizonUrl: 'https://horizon-testnet.invalid' },
};

/** Error state against the dark palette. */
export const ErrorStateDark: Story = {
  args: { horizonUrl: 'https://horizon-testnet.invalid' },
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};

/** Polling every 10s; the hook floors the interval at 5s. */
export const Polling: Story = {
  args: { pollIntervalMs: 10_000 },
};

/** A specific account rather than the connected wallet's. */
export const ExplicitAccount: Story = {
  args: { publicKey: ISSUER },
};
