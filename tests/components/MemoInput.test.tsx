/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MemoInput from '../../src/templates/default/src/components/MemoInput';
import { I18nProvider } from '../../src/templates/default/src/contexts/I18nProvider';

describe('MemoInput Component (#1466)', () => {
  it('renders select and input with accessible labels and attributes', () => {
    const handleTypeChange = jest.fn();
    const handleValueChange = jest.fn();

    render(
      <MemoInput
        id="test-memo"
        memoType="text"
        memoValue="Hello"
        onMemoTypeChange={handleTypeChange}
        onMemoValueChange={handleValueChange}
      />
    );

    const select = screen.getByLabelText(/memo type/i);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('text');

    const input = screen.getByLabelText(/memo/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Hello');
  });

  it('calls onMemoTypeChange when selection changes', () => {
    const handleTypeChange = jest.fn();
    const handleValueChange = jest.fn();

    render(
      <MemoInput
        memoType="text"
        memoValue=""
        onMemoTypeChange={handleTypeChange}
        onMemoValueChange={handleValueChange}
      />
    );

    const select = screen.getByLabelText(/memo type/i);
    fireEvent.change(select, { target: { value: 'id' } });

    expect(handleTypeChange).toHaveBeenCalledWith('id');
  });

  it('calls onMemoValueChange when input text changes', () => {
    const handleTypeChange = jest.fn();
    const handleValueChange = jest.fn();

    render(
      <MemoInput
        memoType="text"
        memoValue=""
        onMemoTypeChange={handleTypeChange}
        onMemoValueChange={handleValueChange}
      />
    );

    const input = screen.getByLabelText(/memo/i);
    fireEvent.change(input, { target: { value: 'Stellar test' } });

    expect(handleValueChange).toHaveBeenCalledWith('Stellar test');
  });

  it('validates memo length and format', () => {
    render(
      <MemoInput
        memoType="text"
        memoValue="This text memo is definitely much longer than 28 bytes allowed"
        onMemoTypeChange={() => {}}
        onMemoValueChange={() => {}}
      />
    );

    const error = screen.getByRole('paragraph', { hidden: true });
    expect(error.textContent).toMatch(/maximum is 28/i);
  });

  it('disables input when memoType is none', () => {
    render(
      <MemoInput
        memoType="none"
        memoValue=""
        onMemoTypeChange={() => {}}
        onMemoValueChange={() => {}}
      />
    );

    const input = screen.getByLabelText(/memo/i);
    expect(input).toBeDisabled();
  });

  it('respects readOnly and displays locked reason', () => {
    render(
      <MemoInput
        memoType="id"
        memoValue="12345"
        readOnly={true}
        lockedReason="Memo required by destination (locked)."
        onMemoTypeChange={() => {}}
        onMemoValueChange={() => {}}
      />
    );

    const select = screen.getByLabelText(/memo type/i);
    expect(select).toBeDisabled();

    const input = screen.getByLabelText(/memo/i);
    expect(input).toHaveAttribute('readonly');

    expect(
      screen.getByText(/memo required by destination/i)
    ).toBeInTheDocument();
  });

  it('works with I18nProvider context', () => {
    render(
      <I18nProvider>
        <MemoInput
          memoType="text"
          memoValue="Test"
          onMemoTypeChange={() => {}}
          onMemoValueChange={() => {}}
        />
      </I18nProvider>
    );

    expect(screen.getByLabelText(/memo type/i)).toBeInTheDocument();
  });
});
