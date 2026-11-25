/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { jest } from '@jest/globals';
import { AssetPicker, type PickerAsset } from '../components/AssetPicker';
import { I18nProvider } from '../contexts/I18nProvider';
import { en } from '../locales/en';

const first = { code: 'USDC', issuer: 'GFIRST' };
const second = { code: 'USDC', issuer: 'GSECOND' };
const balances = [
  { asset_type: 'native' },
  { asset_type: 'credit_alphanum4', asset_code: first.code, asset_issuer: first.issuer },
];

function renderPicker(withTrustlines = true) {
  const onChange = jest.fn<(asset: PickerAsset) => void>();
  function ControlledPicker() {
    const [value, setValue] = useState<PickerAsset | null>(null);
    return (
      <I18nProvider>
        <AssetPicker
          value={value}
          balances={withTrustlines ? balances : undefined}
          assets={withTrustlines ? [first, second] : undefined}
          onChange={(value) => {
            onChange(value);
            setValue(value);
          }}
        />
      </I18nProvider>
    );
  }

  render(<ControlledPicker />);
  const input = screen.getByRole('combobox', { name: en.assetPicker.label });
  fireEvent.focus(input);
  return { input, onChange };
}

describe('AssetPicker', () => {
  it('offers native XLM by default', () => {
    const { input, onChange } = renderPicker(false);
    const list = screen.getByRole('listbox', { name: en.assetPicker.list });
    expect(input).toHaveAttribute('aria-controls', list.id);
    const [xlm] = within(list).getAllByRole('option');
    expect(xlm).toHaveTextContent('XLM');
    expect(xlm).toHaveTextContent(en.assetPicker.native);
    fireEvent.click(xlm);
    expect(onChange).toHaveBeenCalledWith({ code: 'XLM' });
    expect(input).toHaveValue('XLM');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('deduplicates a trustline and distinguishes the same code by issuer', () => {
    const { input, onChange } = renderPicker();
    const options = screen.getAllByRole('option', { name: /USDC/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent(first.issuer);
    expect(options[1]).toHaveTextContent(second.issuer);

    fireEvent.click(options[1]);
    expect(onChange).toHaveBeenCalledWith(second);
    expect(input).toHaveAccessibleDescription(`Issuer: ${second.issuer}`);
  });

  it('filters by code or issuer and reports an empty result', () => {
    const { input } = renderPicker();
    fireEvent.change(input, { target: { value: ' usdc ' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.change(input, { target: { value: 'second' } });
    expect(screen.getByRole('option')).toHaveTextContent(second.issuer);
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(en.assetPicker.noResults);
  });

  it('selects from the keyboard using the active descendant', () => {
    const { input, onChange } = renderPicker();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: /GFIRST/ });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(first);
    expect(input).toHaveValue(first.code);
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('restores the selected asset on Escape without emitting another change', () => {
    const { input, onChange } = renderPicker();
    fireEvent.click(screen.getByRole('option', { name: /GFIRST/ }));
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'XLM' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(first.code);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
