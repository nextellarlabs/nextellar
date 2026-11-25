import type { Meta, StoryObj } from '@storybook/react';
import type { ComponentType } from 'react';
import { I18nProvider } from '../contexts/I18nProvider';
import { WalletContext } from '../contexts/WalletProvider';
import { __setClaimableScenario, type ClaimableScenario } from '../../.storybook/mocks/useClaimableBalances';
import ClaimableBalanceList from './ClaimableBalanceList';

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const wallet = {
  connected: true,
  publicKey: ADDRESS,
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: async () => {},
  disconnect: () => {},
  refreshBalances: async () => {},
  switchAccount: async () => {},
  networkMismatch: false,
};

const withScenario = (next: ClaimableScenario, connected = true) => (Story: ComponentType) => {
  __setClaimableScenario(next);
  return (
    <I18nProvider>
      <WalletContext.Provider value={connected ? wallet : { ...wallet, connected: false, publicKey: undefined }}>
        <Story />
      </WalletContext.Provider>
    </I18nProvider>
  );
};

const meta = {
  title: 'Components/ClaimableBalanceList',
  component: ClaimableBalanceList,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ClaimableBalanceList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = { decorators: [withScenario('populated')] };
export const Loading: Story = { decorators: [withScenario('loading')] };
export const Empty: Story = { decorators: [withScenario('empty')] };
export const Error: Story = { decorators: [withScenario('error')] };
export const Disconnected: Story = { decorators: [withScenario('empty', false)] };
export const PopulatedDark: Story = {
  decorators: [withScenario('populated'), (Story) => <div className="dark bg-gray-900 p-6"><Story /></div>],
  parameters: { backgrounds: { default: 'dark' } },
};
