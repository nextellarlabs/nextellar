import type { Meta, StoryObj } from '@storybook/react';
import FeeSelector from './FeeSelector';

const meta = {
  title: 'Components/FeeSelector',
  component: FeeSelector,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof FeeSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StandardSelected: Story = {
  args: {
    selectedPreset: 'standard',
    onPresetChange: () => {},
  },
};

export const LowSelected: Story = {
  args: {
    selectedPreset: 'low',
    onPresetChange: () => {},
  },
};

export const HighSelected: Story = {
  args: {
    selectedPreset: 'high',
    onPresetChange: () => {},
  },
};

export const Disabled: Story = {
  args: {
    selectedPreset: 'standard',
    disabled: true,
    onPresetChange: () => {},
  },
};
