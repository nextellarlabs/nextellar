/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/ToastProvider';
import { I18nProvider } from '../contexts/I18nProvider';
import { en } from '../locales/en';

const explorerUrl = new URL('https://explorer.example/tx/example');

function Probe() {
  const notify = useToast();
  return (
    <>
      <button type="button" onClick={() => notify({ status: 'success', explorerUrl })}>
        Notify success
      </button>
      <button type="button" onClick={() => notify({ status: 'error' })}>
        Notify failure
      </button>
    </>
  );
}

function renderProvider() {
  render(
    <I18nProvider>
      <ToastProvider>
        <Probe />
      </ToastProvider>
    </I18nProvider>,
  );
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function notifySuccess() {
  fireEvent.click(screen.getByRole('button', { name: 'Notify success' }));
}

describe('ToastProvider', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('announces success and failure through separate live regions', () => {
    renderProvider();
    const status = screen.getByRole('status');
    const alert = screen.getByRole('alert');
    expect(status).toBeEmptyDOMElement();
    expect(alert).toBeEmptyDOMElement();

    notifySuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Notify failure' }));

    expect(status).toHaveTextContent(en.toast.success);
    expect(alert).toHaveTextContent(en.toast.error);
    const region = screen.getByRole('region', { name: en.toast.notifications });
    const [confirmed, failed] = within(region).getAllByRole('listitem');
    expect(within(confirmed).getByRole('link', { name: en.toast.viewInExplorer }))
      .toHaveAttribute('href', explorerUrl.href);
    expect(within(failed).queryByRole('link')).toBeNull();
  });

  it('automatically dismisses a toast after six seconds', () => {
    renderProvider();
    notifySuccess();
    advance(5999);
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('pauses on hover and resumes with the time left', () => {
    renderProvider();
    notifySuccess();
    const toast = screen.getByRole('listitem');
    advance(4000);
    fireEvent.mouseEnter(toast);
    advance(6000);
    expect(toast).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    advance(1999);
    expect(toast).toBeInTheDocument();
    advance(1);
    expect(toast).not.toBeInTheDocument();
  });

  it('keeps a focused action available and supports manual dismissal', () => {
    renderProvider();
    notifySuccess();
    const link = screen.getByRole('link', { name: en.toast.viewInExplorer });
    const dismiss = screen.getByRole('button', { name: en.toast.dismiss });
    act(() => link.focus());
    advance(7000);
    expect(link).toHaveFocus();
    act(() => dismiss.focus());
    advance(7000);
    expect(dismiss).toHaveFocus();
    fireEvent.click(dismiss);
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
