/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ComponentProps } from 'react';
import { I18nProvider } from '../contexts/I18nProvider';
import TransactionConfirmModal from '../components/TransactionConfirmModal';

expect.extend(toHaveNoViolations);

const operations = [
  {
    type: 'Payment',
    summary: 'Send 25 XLM to GABC…WXYZ',
    details: [
      { label: 'Destination', value: 'GABC…WXYZ' },
      { label: 'Asset', value: 'XLM' },
    ],
  },
];

function renderModal(props: Partial<ComponentProps<typeof TransactionConfirmModal>> = {}) {
  return render(
    <I18nProvider>
      <TransactionConfirmModal
        open
        operations={operations}
        fee={{ amount: '100', asset: 'stroops' }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('TransactionConfirmModal', () => {
  it('shows translated dialog content, operation details, and the fee', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: 'Review transaction' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByText('Send 25 XLM to GABC…WXYZ')).toBeInTheDocument();
    expect(screen.getByText('GABC…WXYZ')).toBeInTheDocument();
    expect(screen.getByText('100 stroops')).toBeInTheDocument();
  });

  it('requires an explicit confirm action to call onConfirm', () => {
    const onConfirm = jest.fn();
    renderModal({ onConfirm });

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and sign' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('traps keyboard focus and cancels on Escape', () => {
    const onCancel = jest.fn();
    renderModal({ onCancel });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm and sign' });

    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    renderModal({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no axe accessibility violations when open', async () => {
    const { container } = renderModal();

    expect(await axe(container)).toHaveNoViolations();
  });
});
