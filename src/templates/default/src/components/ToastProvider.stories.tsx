import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';
import { I18nProvider, useTranslation } from '../contexts/I18nProvider';
import { ToastProvider, useToast, type TransactionToast } from './ToastProvider';

const previewUrl = new URL(
  `https://stellar.expert/explorer/testnet/tx/${'0'.repeat(64)}`,
);

function ToastExample({ status }: Pick<TransactionToast, 'status'>) {
  const notify = useToast();
  const { t } = useTranslation();

  return (
    <button
      className="rounded-md border border-neutral-400 px-4 py-2 text-sm"
      type="button"
      onClick={() => notify({ status, explorerUrl: status === 'success' ? previewUrl : undefined })}
    >
      {t(status === 'success' ? 'toast.success' : 'toast.error')}
    </button>
  );
}

const meta = {
  title: 'Components/ToastProvider',
  component: ToastExample,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <I18nProvider>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </I18nProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button'));
  },
} satisfies Meta<typeof ToastExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = { args: { status: 'success' } };
export const Error: Story = { args: { status: 'error' } };
