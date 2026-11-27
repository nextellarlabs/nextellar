import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { I18nProvider } from '../contexts/I18nProvider';
import { WalletContext } from '../contexts/WalletProvider';
import SignerManager, { type SignerManagerProps } from './SignerManager';
import {
  __setStellarAccountScenario,
  type StellarAccountScenario,
} from '../../.storybook/mocks/useStellarAccount';

type WalletContextValue = NonNullable<React.ContextType<typeof WalletContext>>;

const PRIMARY_ACCOUNT =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const connectedWallet: WalletContextValue = {
  connected: true,
  publicKey: PRIMARY_ACCOUNT,
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: async () => {},
  disconnect: () => {},
  refreshBalances: async () => {},
  switchAccount: async () => {},
  sendPayment: undefined,
  networkMismatch: false,
};

const disconnectedWallet: WalletContextValue = {
  ...connectedWallet,
  connected: false,
  publicKey: undefined,
};

const withAccountScenario =
  (
    scenario: StellarAccountScenario,
    wallet: WalletContextValue = connectedWallet,
  ) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) => {
    __setStellarAccountScenario(scenario);
    return (
      <I18nProvider>
        <WalletContext.Provider value={wallet}>
          <div className="w-[720px] max-w-full">
            <Story />
          </div>
        </WalletContext.Provider>
      </I18nProvider>
    );
  };

const meta = {
  title: 'Components/SignerManager',
  component: SignerManager,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<SignerManagerProps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultisigPopulated: Story = {
  decorators: [withAccountScenario('multisig')],
};

export const SingleSigner: Story = {
  decorators: [withAccountScenario('singleSigner')],
};

export const LockoutWarningDetected: Story = {
  decorators: [withAccountScenario('lockoutRisk')],
};

export const Disconnected: Story = {
  decorators: [withAccountScenario('multisig', disconnectedWallet)],
};

export const UnfundedAccount: Story = {
  decorators: [withAccountScenario('unfunded')],
};

export const Loading: Story = {
  decorators: [withAccountScenario('loading')],
};

export const HorizonError: Story = {
  decorators: [withAccountScenario('error')],
};

export const DarkTheme: Story = {
  decorators: [
    withAccountScenario('multisig'),
    (Story) => (
      <div className="dark rounded-xl bg-gray-950 p-6">
        <Story />
      </div>
    ),
  ],
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
