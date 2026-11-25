/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FeeSelector from '../components/FeeSelector';
import { I18nProvider } from '../contexts/I18nProvider';

jest.mock('../hooks/useFeeEstimate', () => ({
  useFeeEstimate: () => ({
    loading: false,
    error: null,
    baseFee: '100',
    presets: { low: '100', standard: '150', high: '300' },
    stroopsToXlm: (s: string) => (Number(s) / 10000000).toFixed(7),
    refresh: jest.fn(),
    getFeeForPreset: (p: string) => p === 'low' ? '100' : p === 'standard' ? '150' : '300',
  }),
}));

describe('FeeSelector Component', () => {
  it('renders radiogroup with low, standard, and high preset options', () => {
    const handleChange = jest.fn();
    render(
      <FeeSelector selectedPreset="standard" onPresetChange={handleChange} />
    );

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);

    expect(screen.getByText(/standard/i)).toBeInTheDocument();
    expect(screen.getByText(/low/i)).toBeInTheDocument();
    expect(screen.getByText(/high/i)).toBeInTheDocument();
  });

  it('indicates which preset is selected via aria-checked', () => {
    render(
      <FeeSelector selectedPreset="standard" onPresetChange={() => {}} />
    );

    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[2]).toHaveAttribute('aria-checked', 'false');
  });

  it('shows estimated cost in XLM', () => {
    render(
      <FeeSelector selectedPreset="standard" onPresetChange={() => {}} />
    );

    expect(screen.getByText(/0.0000150 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/0.0000100 XLM/i)).toBeInTheDocument();
    expect(screen.getByText(/0.0000300 XLM/i)).toBeInTheDocument();
  });

  it('calls onPresetChange when a preset option is clicked', () => {
    const handleChange = jest.fn();
    render(
      <FeeSelector selectedPreset="standard" onPresetChange={handleChange} />
    );

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // Low preset
    expect(handleChange).toHaveBeenCalledWith('low');

    fireEvent.click(radios[2]); // High preset
    expect(handleChange).toHaveBeenCalledWith('high');
  });

  it('disables all radio buttons when disabled prop is true', () => {
    render(
      <FeeSelector selectedPreset="standard" disabled={true} onPresetChange={() => {}} />
    );

    const radios = screen.getAllByRole('radio');
    radios.forEach((radio) => {
      expect(radio).toBeDisabled();
    });
  });

  it('renders with I18nProvider context', () => {
    render(
      <I18nProvider>
        <FeeSelector selectedPreset="standard" onPresetChange={() => {}} />
      </I18nProvider>
    );

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });
});
