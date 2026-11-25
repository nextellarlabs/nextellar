import type { Meta, StoryObj } from '@storybook/react';
import { xdr } from '@stellar/stellar-sdk';
import ContractEventFeed from './ContractEventFeed';
import { I18nProvider } from '../contexts/I18nProvider';
import type { SorobanEvent } from '../hooks/useSorobanEvents';

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const sym = (s: string) => xdr.ScVal.scvSymbol(s).toXDR('base64');
const str = (s: string) => xdr.ScVal.scvString(s).toXDR('base64');
const u32 = (n: number) => xdr.ScVal.scvU32(n).toXDR('base64');

function makeEvent(
  index: number,
  topicName: string,
  detail: string,
  amount: number,
  success = true
): SorobanEvent {
  return {
    id: `0001284500-${String(index).padStart(6, '0')}`,
    type: 'contract',
    ledger: 1284500 + index,
    ledgerClosedAt: new Date(Date.UTC(2026, 0, 15, 12, 0, index % 60)).toISOString(),
    contractId: CONTRACT_ID,
    topic: [sym(topicName), str(detail)],
    value: u32(amount),
    txHash: `a1b2c3d4e5f60718293a4b5c6d7e8f90${String(index).padStart(8, '0')}`,
    inSuccessfulContractCall: success,
  };
}

const SAMPLE_EVENTS: SorobanEvent[] = [
  makeEvent(4, 'transfer', 'GABC...XYZ1', 2500),
  makeEvent(3, 'mint', 'GDEF...UVW2', 10000),
  makeEvent(2, 'approve', 'GHIJ...RST3', 500),
  makeEvent(1, 'burn', 'GKLM...OPQ4', 125, false),
];

const LONG_FEED_EVENTS: SorobanEvent[] = Array.from({ length: 500 }, (_, i) => {
  const topics = ['transfer', 'mint', 'burn', 'approve', 'swap'];
  return makeEvent(500 - i, topics[i % topics.length], `acct_${i}`, (i + 1) * 10);
});

const meta = {
  title: 'Components/ContractEventFeed',
  component: ContractEventFeed,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <I18nProvider>
        <div className="w-[640px] max-w-full">
          <Story />
        </div>
      </I18nProvider>
    ),
  ],
  args: {
    contractId: CONTRACT_ID,
    pollIntervalMs: null,
  },
} satisfies Meta<typeof ContractEventFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Live feed populated with decoded Soroban contract events and topic filters. */
export const Populated: Story = {
  args: {
    events: SAMPLE_EVENTS,
  },
};

/** Virtualized feed with 500 decoded events — only visible rows are mounted in the DOM. */
export const VirtualizedLongFeed: Story = {
  args: {
    events: LONG_FEED_EVENTS,
    height: 420,
  },
};

/** Initial loading state with skeleton rows. */
export const Loading: Story = {
  args: {
    events: [],
    loading: true,
  },
};

/** Empty state when no contract events have been emitted yet. */
export const Empty: Story = {
  args: {
    events: [],
    loading: false,
  },
};

/** Error state when Soroban RPC fails. */
export const ErrorState: Story = {
  args: {
    events: [],
    error: new Error('Soroban RPC unavailable: 503 Service Unavailable'),
  },
};

/** Recovering banner shown while polling retries in the background. */
export const Recovering: Story = {
  args: {
    events: SAMPLE_EVENTS,
    isRecovering: true,
  },
};

/** Populated feed rendered against the dark palette. */
export const PopulatedDark: Story = {
  args: {
    events: SAMPLE_EVENTS,
  },
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};
