/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactNode } from 'react';

// This repo runs Jest under real ESM (--experimental-vm-modules), so
// jest.unstable_mockModule (registered and awaited before the module under
// test is imported) is the way to intercept the hook — see WalletProvider.test.
const mockUseStellarBalances = jest.fn();
const mockRefresh = jest.fn();

await jest.unstable_mockModule('../hooks/useStellarBalances', () => ({
  useStellarBalances: mockUseStellarBalances,
}));

const { default: BalanceDisplay } = await import('../components/BalanceDisplay');
const { WalletContext } = await import('../contexts/WalletProvider');

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const baseWalletState = {
  connected: true,
  publicKey: ADDRESS,
  walletName: 'Freighter',
  balances: [],
  accounts: [],
  connect: jest.fn(),
  disconnect: jest.fn(),
  refreshBalances: jest.fn(),
  switchAccount: jest.fn(),
  currentAccountIndex: 0,
};

const renderWithWallet = (component: ReactNode, overrides: Record<string, unknown> = {}) =>
  render(
    <WalletContext.Provider value={{ ...baseWalletState, ...overrides }}>
      {component}
    </WalletContext.Provider>,
  );

/** Builds the hook's return value; every test differs by only a field or two. */
const hookState = (overrides: Record<string, unknown> = {}) => ({
  balances: [],
  loading: false,
  error: null,
  refresh: mockRefresh,
  stopPolling: jest.fn(),
  ...overrides,
});

describe('BalanceDisplay Component (#838)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseStellarBalances.mockReturnValue(hookState());
  });

  it('prompts to connect when no wallet is connected and no address is passed', () => {
    renderWithWallet(<BalanceDisplay />, { connected: false, publicKey: undefined });

    expect(screen.getByText('Connect wallet to view balances')).toBeInTheDocument();
  });

  it('shows a loading state on the first load', () => {
    mockUseStellarBalances.mockReturnValue(hookState({ loading: true }));
    renderWithWallet(<BalanceDisplay />);

    expect(screen.getByRole('status', { name: 'Loading balances' })).toBeInTheDocument();
  });

  it('shows an empty state when the account has no balances', () => {
    renderWithWallet(<BalanceDisplay />);

    expect(screen.getByText('No balances yet')).toBeInTheDocument();
    expect(screen.getByText(/may still need funding/i)).toBeInTheDocument();
  });

  it('renders an error with a retry that re-runs the fetch', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({ error: new Error('Network error: Horizon unreachable') }),
    );
    renderWithWallet(<BalanceDisplay />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Failed to load balances')).toBeInTheDocument();
    expect(screen.getByText('Network error: Horizon unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders the native balance as the headline figure', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({ balances: [{ asset_type: 'native', balance: '100.5000000' }] }),
    );
    renderWithWallet(<BalanceDisplay />);

    expect(screen.getByText('Native')).toBeInTheDocument();
    expect(screen.getByText(/100\.5/)).toBeInTheDocument();
    expect(screen.getByText('XLM')).toBeInTheDocument();
  });

  it('renders credit assets alongside the native balance', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({
        balances: [
          { asset_type: 'native', balance: '100.0000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: ISSUER,
            balance: '250.7500000',
          },
        ],
      }),
    );
    renderWithWallet(<BalanceDisplay />);

    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText(/250\.75/)).toBeInTheDocument();
    // The issuer is truncated rather than shown in full.
    expect(screen.getByText(`${ISSUER.slice(0, 4)}...${ISSUER.slice(-4)}`)).toBeInTheDocument();
  });

  it('still lists assets when the account holds no native balance', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({
        balances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: ISSUER,
            balance: '10.0000000',
          },
        ],
      }),
    );
    renderWithWallet(<BalanceDisplay />);

    expect(screen.queryByText('Native')).not.toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
  });

  it('keeps balances on screen and surfaces the error when a refresh fails', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
        error: new Error('Failed to refresh'),
      }),
    );
    renderWithWallet(<BalanceDisplay />);

    // Stale data stays visible rather than being replaced by the error page.
    expect(screen.getByText('Native')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to refresh');
  });

  it('queries the supplied publicKey in preference to the connected wallet', () => {
    const other = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
    renderWithWallet(<BalanceDisplay publicKey={other} />);

    expect(mockUseStellarBalances).toHaveBeenCalledWith(other, expect.any(Object));
  });

  it('refreshes on demand from the populated view', () => {
    mockUseStellarBalances.mockReturnValue(
      hookState({ balances: [{ asset_type: 'native', balance: '1.0000000' }] }),
    );
    renderWithWallet(<BalanceDisplay />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh balances' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
