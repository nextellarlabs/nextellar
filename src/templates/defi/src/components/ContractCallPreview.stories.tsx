import type { Meta, StoryObj } from '@storybook/react';
import ContractCallPreview, { type SimulationPreview } from './ContractCallPreview';

// Shaped like the SimulateContractCallResult that useSorobanContract's
// simulateContractCall resolves with: an `increment` call on the Soroban
// example counter contract, whose u32 return value decodes to a number.
const PREVIEW: SimulationPreview = {
  result: 3,
  minResourceFee: '48213',
  latestLedger: 1284561,
};

const meta = {
  title: 'Components/ContractCallPreview',
  component: ContractCallPreview,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContractCallPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Simulation RPC call in flight — spinner plus skeleton rows, announced politely. */
export const Loading: Story = {
  args: { loading: true },
};

/**
 * Simulation failed (e.g. the contract reverted). Shows the error message and
 * a "Go back" button because `onCancel` is supplied.
 */
export const SimulationError: Story = {
  args: {
    error: new Error('Simulation failed: HostError: Error(Contract, #2)'),
    onCancel: () => {},
  },
};

/**
 * Successful simulation — estimated fee in stroops and XLM, the decoded return
 * value and the ledger it was simulated at, with Cancel / Confirm & Submit.
 */
export const Populated: Story = {
  args: {
    preview: PREVIEW,
    onConfirm: () => {},
    onCancel: () => {},
  },
};

/** A call with no return value (e.g. `transfer`) renders the result as "(void)". */
export const VoidResult: Story = {
  args: {
    preview: { ...PREVIEW, result: null },
    onConfirm: () => {},
    onCancel: () => {},
  },
};

/** Preview without callbacks — read-only, so no action buttons render. */
export const ReadOnly: Story = {
  args: { preview: PREVIEW },
};

/** Populated preview rendered against the dark palette. */
export const PopulatedDark: Story = {
  args: {
    preview: PREVIEW,
    onConfirm: () => {},
    onCancel: () => {},
  },
  globals: { theme: 'dark' },
  parameters: { backgrounds: { default: 'dark' } },
};
