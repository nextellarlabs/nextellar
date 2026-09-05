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
import BalanceDisplay from './BalanceDisplay';
import { __setBalanceScenario, type BalanceScenario } from '../../.storybook/mocks/useStellarBalances';

type WalletContextValue = NonNullable<React.ContextType<typeof WalletContext>>;

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

// A connected wallet context is required because BalanceDisplay reads
// `connected`/`publicKey` from useWallet before it ever reaches the balances
// hook. The hook itself is mocked (see .storybook/mocks/useStellarBalances).
const connectedWallet: WalletContextValue = {
  connected: true,
  publicKey: WALLET,
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: async () => {},
  disconnect: async () => {},
  refreshBalances: async () => {},
  switchAccount: async () => {},
  sendPayment: undefined,
};

const disconnectedWallet: WalletContextValue = {
  ...connectedWallet,
  connected: false,
  publicKey: undefined,
};

// Drives the mocked useStellarBalances hook to a given scenario, then wraps
// the story in a connected (or disconnected) wallet context.
const withBalances =
  (scenario: BalanceScenario, wallet: WalletContextState = connectedWallet) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) => {
    __setBalanceScenario(scenario);
    return (
      <WalletContext.Provider value={wallet}>
        <Story />
      </WalletContext.Provider>
    );
  };

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
/**
 * No wallet connected — BalanceDisplay short-circuits before the balances
 * hook and shows the "Connect a wallet to view balances" empty state.
 */
export const Disconnected: Story = {
  decorators: [withBalances('empty', disconnectedWallet)],
};

/** Initial load — skeleton rows with an announced loading state. */
export const Loading: Story = {
  decorators: [withBalances('loading')],
};

/** Connected wallet with no balances yet (e.g. unfunded account). */
export const Empty: Story = {
  decorators: [withBalances('empty')],
};

/** Failed to load balances before any rows rendered, with a retry affordance. */
export const Error: Story = {
  decorators: [withBalances('error')],
};

/** A connected wallet with native XLM and a USDC asset balance. */
export const Populated: Story = {
  decorators: [withBalances('populated')],
};

/**
 * Populated state rendered on a dark background. Wrapping in a `.dark`
 * ancestor activates the component's `dark:` Tailwind variants.
 */
export const PopulatedDark: Story = {
  decorators: [
    withBalances('populated'),
    (Story) => (
      <div className="dark bg-gray-900 p-6 rounded-lg">
        <Story />
      </div>
    ),
  ],
  parameters: { backgrounds: { default: 'dark' } },
};
