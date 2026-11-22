/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import AccountSwitcher from '../components/AccountSwitcher';
import { WalletContext, defaultWalletState } from '../../../../mocks/wallet-contexts-mock';

describe('AccountSwitcher (minimal)', () => {
  it('renders nothing when not connected', () => {
    const { container } = render(
      <WalletContext.Provider value={defaultWalletState()}>
        <AccountSwitcher />
      </WalletContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when connected but publicKey is missing', () => {
    const { container } = render(
      <WalletContext.Provider value={{ ...defaultWalletState(), connected: true, publicKey: undefined }}>
        <AccountSwitcher />
      </WalletContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a shortened address when connected', () => {
    render(
      <WalletContext.Provider
        value={{
          ...defaultWalletState(),
          connected: true,
          publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
        }}
      >
        <AccountSwitcher />
      </WalletContext.Provider>,
    );
    expect(screen.getByText(/GABC\.\.\.4567/)).toBeInTheDocument();
  });

  it('prefixes the wallet name when known', () => {
    render(
      <WalletContext.Provider
        value={{
          ...defaultWalletState(),
          connected: true,
          publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
          walletName: 'Freighter',
        }}
      >
        <AccountSwitcher />
      </WalletContext.Provider>,
    );
    expect(screen.getByText(/Freighter: GABC\.\.\.4567/)).toBeInTheDocument();
  });

  it('exposes the full address via the title attribute', () => {
    const address = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const { container } = render(
      <WalletContext.Provider
        value={{ ...defaultWalletState(), connected: true, publicKey: address }}
      >
        <AccountSwitcher />
      </WalletContext.Provider>,
    );
    expect(container.querySelector(`[title="${address}"]`)).toBeInTheDocument();
  });
});
