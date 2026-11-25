import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { I18nProvider } from '../contexts/I18nProvider';
import AddressInput, { type AddressInputProps } from './AddressInput';

type StoryArgs = AddressInputProps & {
  theme?: 'light' | 'dark';
};

const VALID_ACCOUNT =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const VALID_MUXED =
  'MBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OAAAAAAAAAAAFJMRM';
const VALID_CONTRACT =
  'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const INVALID_CHECKSUM_ACCOUNT =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2A';

function StoryShell({
  theme = 'light',
  children,
}: {
  theme?: 'light' | 'dark';
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="w-[460px] max-w-full rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          {children}
        </div>
      </div>
    </I18nProvider>
  );
}

const meta: Meta<StoryArgs> = {
  title: 'Components/AddressInput',
  component: AddressInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  render: ({ theme, ...props }) => (
    <StoryShell theme={theme}>
      <AddressInput {...props} />
    </StoryShell>
  ),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {},
};

export const ClassicAccount: Story = {
  args: {
    defaultValue: VALID_ACCOUNT,
  },
};

export const MuxedAccount: Story = {
  args: {
    defaultValue: VALID_MUXED,
  },
};

export const ContractAddress: Story = {
  args: {
    defaultValue: VALID_CONTRACT,
  },
};

export const InvalidChecksumError: Story = {
  args: {
    defaultValue: INVALID_CHECKSUM_ACCOUNT,
  },
};

export const ClassicAccountOnlyDisallowedContract: Story = {
  args: {
    defaultValue: VALID_CONTRACT,
    allowedTypes: ['G'],
  },
};

export const DarkTheme: Story = {
  args: {
    defaultValue: VALID_ACCOUNT,
    theme: 'dark',
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};
