import type { Meta, StoryObj } from '@storybook/react';
import { I18nProvider } from '../contexts/I18nProvider';
import TransactionConfirmModal from './TransactionConfirmModal';

const meta = {
  title: 'Components/TransactionConfirmModal',
  component: TransactionConfirmModal,
  decorators: [
    (Story) => (
      <I18nProvider>
        <Story />
      </I18nProvider>
    ),
  ],
  args: {
    open: true,
    operations: [
      {
        type: 'Payment',
        summary: 'Send 25.0000000 XLM to GABC…WXYZ',
        details: [
          { label: 'Destination', value: 'GABC…WXYZ' },
          { label: 'Asset', value: 'XLM' },
        ],
      },
    ],
    fee: { amount: '100', asset: 'stroops' },
    onConfirm: () => {},
    onCancel: () => {},
  },
  argTypes: {
    theme: { control: 'radio', options: ['light', 'dark'] },
  },
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof TransactionConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewPayment: Story = {};

export const MultipleOperations: Story = {
  args: {
    operations: [
      {
        type: 'Payment',
        summary: 'Send 25.0000000 XLM to GABC…WXYZ',
        details: [{ label: 'Destination', value: 'GABC…WXYZ' }],
      },
      {
        type: 'Change trustline',
        summary: 'Trustline limit updated for USD:GBANK…',
      },
    ],
  },
};

export const DarkTheme: Story = {
  args: { theme: 'dark' },
};
