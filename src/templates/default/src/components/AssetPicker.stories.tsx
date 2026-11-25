import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';
import { I18nProvider } from '../contexts/I18nProvider';
import { AssetPicker, type AssetPickerProps, type PickerAsset } from './AssetPicker';

function Example(props: Pick<AssetPickerProps, 'balances' | 'assets'>) {
  const [asset, setAsset] = useState<PickerAsset | null>(null);
  return (
    <I18nProvider>
      <div className="min-h-72 w-80 max-w-full">
        <AssetPicker {...props} value={asset} onChange={setAsset} />
      </div>
    </I18nProvider>
  );
}

const meta = {
  title: 'Components/AssetPicker',
  component: Example,
  parameters: { layout: 'centered' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox'));
  },
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NativeOnly: Story = {};
export const TrustlinesAndSearchableAssets: Story = {
  args: {
    balances: [
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: `G${'A'.repeat(55)}` },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: `G${'B'.repeat(55)}` },
    ],
    assets: [{ code: 'EURC', issuer: `G${'C'.repeat(55)}` }],
  },
};
