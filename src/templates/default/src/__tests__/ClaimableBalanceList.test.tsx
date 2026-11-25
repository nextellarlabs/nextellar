/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ClaimableBalance } from '../hooks/useClaimableBalances';

const mockUseClaimableBalances = jest.fn();
const mockClaim = jest.fn<(...args: string[]) => Promise<void>>();
const mockRefresh = jest.fn();

await jest.unstable_mockModule('../hooks/useClaimableBalances', () => ({
  useClaimableBalances: mockUseClaimableBalances,
  canClaimBalance: (balance: ClaimableBalance, key: string) =>
    balance.claimants.some(({ destination, predicate }) => destination === key && 'unconditional' in predicate && predicate.unconditional),
}));

const { default: ClaimableBalanceList } = await import('../components/ClaimableBalanceList');
const { I18nProvider } = await import('../contexts/I18nProvider');
const { WalletContext } = await import('../contexts/WalletProvider');

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const balance = (id: string, eligible: boolean): ClaimableBalance => ({
  id,
  asset: id === 'ready' ? 'native' : 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  amount: id === 'ready' ? '12.5000000' : '25.0000000',
  claimants: [{ destination: ADDRESS, predicate: { unconditional: eligible } }],
});

const wallet = {
  connected: true,
  publicKey: ADDRESS,
  balances: [],
  accounts: [],
  currentAccountIndex: 0,
  connect: jest.fn(),
  disconnect: jest.fn(),
  refreshBalances: jest.fn(),
  switchAccount: jest.fn(),
  networkMismatch: false,
};

function renderList(overrides: Record<string, unknown> = {}, children: ReactNode = <ClaimableBalanceList />) {
  return render(
    <I18nProvider>
      <WalletContext.Provider value={{ ...wallet, ...overrides }}>{children}</WalletContext.Provider>
    </I18nProvider>,
  );
}

describe('ClaimableBalanceList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaim.mockResolvedValue(undefined);
    mockUseClaimableBalances.mockReturnValue({
      balances: [balance('ready', true), balance('pending', false)],
      loading: false,
      error: null,
      refresh: mockRefresh,
      claim: mockClaim,
      claimingId: null,
      claimError: null,
      claimedId: null,
    });
  });

  it('renders balances with accessible claim buttons and disables unmet predicates', async () => {
    renderList();
    expect(screen.getByRole('heading', { name: 'Claimable balances' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Claim 12.5000000 XLM' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Claim 25.0000000 USDC' })).toBeDisabled();
    expect(screen.getByText('Claim unavailable until its conditions are met.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Claim 12.5000000 XLM' }));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('ready'));
  });

  it('keeps read-only accounts and a network-mismatched wallet from claiming', () => {
    renderList({ networkMismatch: true });
    expect(screen.getByRole('button', { name: 'Claim 12.5000000 XLM' })).toBeDisabled();
  });

  it('announces loading, errors, and supports retry', () => {
    mockUseClaimableBalances.mockReturnValueOnce({
      balances: [], loading: true, error: null, refresh: mockRefresh, claim: mockClaim,
      claimingId: null, claimError: null, claimedId: null,
    });
    const view = renderList();
    expect(screen.getByRole('status')).toHaveTextContent('Loading claimable balances');
    view.unmount();

    mockUseClaimableBalances.mockReturnValueOnce({
      balances: [], loading: false, error: new Error('Horizon unavailable'), refresh: mockRefresh, claim: mockClaim,
      claimingId: null, claimError: null, claimedId: null,
    });
    renderList();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load claimable balances.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a translated connection prompt without a wallet', () => {
    renderList({ connected: false, publicKey: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('Connect your wallet to view claimable balances.');
    expect(mockUseClaimableBalances).toHaveBeenCalledWith(undefined, undefined);
  });
});
