/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import ProtocolsPage from '../app/protocols/page';

describe('ProtocolsPage smoke tests', () => {
  it('renders the protocols demo page without a connected wallet', () => {
    render(<ProtocolsPage />);

    // Header and title from i18n
    expect(screen.getByText('Stellar Protocol Demos')).toBeInTheDocument();
    expect(screen.getByText('Testnet Mode')).toBeInTheDocument();

    // No wallet preview notice
    expect(
      screen.getByText('No wallet connected. Viewing in preview mode.')
    ).toBeInTheDocument();

    // Protocol tab navigation
    expect(
      screen.getByRole('button', { name: 'Claimable Balances' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Path Payments' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Liquidity Pools' })
    ).toBeInTheDocument();
  });

  it('allows switching between protocol demonstration tabs without wallet', () => {
    render(<ProtocolsPage />);

    // Switch to Path Payments tab
    fireEvent.click(screen.getByRole('button', { name: 'Path Payments' }));
    expect(screen.getByText('Testnet Path Payment & Swap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find Best Route' })).toBeInTheDocument();

    // Switch to Liquidity Pools tab
    fireEvent.click(screen.getByRole('button', { name: 'Liquidity Pools' }));
    expect(screen.getByText('Testnet Liquidity Pool (AMM)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect' })).toBeInTheDocument();

    // Switch back to Claimable Balances
    fireEvent.click(screen.getByRole('button', { name: 'Claimable Balances' }));
    expect(screen.getByText('Create Claimable Balance')).toBeInTheDocument();
  });
});
