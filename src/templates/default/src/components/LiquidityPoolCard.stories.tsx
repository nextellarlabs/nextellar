import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { WalletContext } from '../contexts/WalletProvider';
import { I18nProvider } from '../contexts/I18nProvider';
import LiquidityPoolCard from './LiquidityPoolCard';
import {
  __setLiquidityPoolScenario,
  type LiquidityPoolScenario,
} from '../../.storybook/mocks/useLiquidityPool';

type WalletContextValue = NonNullable<React.ContextType<typeof WalletContext>>;

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const POOL_ID = 'dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7';

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

const samplePrices: Record<string, number> = {
  XLM: 0.12,
  USDC: 1.0,
};

const withPool =
  (scenario: LiquidityPoolScenario, wallet: WalletContextValue = connectedWallet) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) => {
    __setLiquidityPoolScenario(scenario);
    return (
      <I18nProvider>
        <WalletContext.Provider value={wallet}>
          <div className="w-[420px]">
            <Story />
          </div>
        </WalletContext.Provider>
      </I18nProvider>
    );
  };

const meta = {
  title: 'Components/LiquidityPoolCard',
  component: LiquidityPoolCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    poolId: POOL_ID,
    getFiatPrice: ({ code }) => samplePrices[code],
    onDeposit: async () => {},
    onWithdraw: async () => {},
  },
} satisfies Meta<typeof LiquidityPoolCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Initial load — skeleton rows with an announced loading state. */
export const Loading: Story = {
  decorators: [withPool('loading')],
};

/** No pool ID provided — renders the empty state. */
export const Empty: Story = {
  args: { poolId: undefined },
  decorators: [withPool('empty')],
};

/** Failed to load pool data — renders an alert with a retry button. */
export const Error: Story = {
  decorators: [withPool('error')],
};

/** Connected wallet with active LP shares, estimated fiat value, and deposit/withdraw tabs. */
export const Populated: Story = {
  decorators: [withPool('populated')],
};

/** Connected wallet that holds zero shares in this pool. */
export const NoPosition: Story = {
  decorators: [withPool('no-position')],
};

/** Disconnected wallet — displays pool reserves and prompts to connect. */
export const Disconnected: Story = {
  decorators: [withPool('populated', disconnectedWallet)],
};

/** Populated state rendered on a dark background. */
export const PopulatedDark: Story = {
  decorators: [
    withPool('populated'),
    (Story) => (
      <div className="dark bg-gray-900 p-6 rounded-lg">
        <Story />
      </div>
    ),
  ],
  parameters: { backgrounds: { default: 'dark' } },
};
