import React from 'react';
import BalanceDisplay from './BalanceDisplay';
import { WalletContext } from '../contexts/WalletProvider';

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

const connectedWallet = {
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

const meta = {
  title: 'Components/BalanceDisplay',
  component: BalanceDisplay,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;

export const Disconnected = {
  decorators: [(Story) => (
    <WalletContext.Provider value={{ ...connectedWallet, connected: false, publicKey: undefined }}>
      <Story />
    </WalletContext.Provider>
  )],
};

export const Connected = {
  decorators: [(Story) => (
    <WalletContext.Provider value={connectedWallet}>
      <Story />
    </WalletContext.Provider>
  )],
};
