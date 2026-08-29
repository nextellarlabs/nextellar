import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
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
  (scenario: BalanceScenario, wallet: WalletContextValue = connectedWallet) =>
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
} satisfies Meta<typeof BalanceDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

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
