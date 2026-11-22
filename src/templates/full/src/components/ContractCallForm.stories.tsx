import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import ContractCallForm from './ContractCallForm';
import {
  __setContractScenario,
  type ContractScenario,
} from '../../.storybook/mocks/useSorobanContract';

// Stellar testnet native-asset (XLM) contract — a real, well-formed contract ID.
const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQAHHXK3AWCM';

// Drives the mocked useSorobanContract hook (see
// .storybook/mocks/useSorobanContract) to a given scenario before render.
const withContract =
  (scenario: ContractScenario) =>
  // eslint-disable-next-line react/display-name
  (Story: React.ComponentType) => {
    __setContractScenario(scenario);
    return <Story />;
  };

const meta = {
  title: 'Components/ContractCallForm',
  component: ContractCallForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    contractId: CONTRACT_ID,
    onSubmit: async () => {},
  },
} satisfies Meta<typeof ContractCallForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Idle — empty form; Preview stays disabled until a function name is entered. */
export const Idle: Story = {
  decorators: [withContract('idle')],
};

/** Simulation in flight — Preview reads "Simulating…" and the preview panel shows its skeleton. */
export const Simulating: Story = {
  decorators: [withContract('simulating')],
};

/** Simulation failed — the contract error is surfaced with a "Go back" button. */
export const SimulationError: Story = {
  decorators: [withContract('error')],
};

/**
 * Preview — enter a function name and arguments, then click Preview to see the
 * estimated fee and decoded return value before confirming.
 */
export const Preview: Story = {
  decorators: [withContract('idle')],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Function name'), 'increment');
    await userEvent.type(canvas.getByLabelText(/arguments/i), '1, true');
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
  },
};

/** Submitting — buildInvokeXDR never resolves, so the form stays on "Building transaction…". */
export const Submitting: Story = {
  decorators: [withContract('submitting')],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Function name'), 'increment');
    await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
    await userEvent.click(
      await canvas.findByRole('button', { name: /confirm & submit/i }),
    );
  },
};
