/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

const mockUseLiquidityPool = jest.fn();
const mockRefresh = jest.fn<() => Promise<void>>();
const mockDeposit = jest.fn<(params: { maxAmountA: string; maxAmountB: string }) => Promise<void>>();
const mockWithdraw = jest.fn<(params: { amount: string }) => Promise<void>>();

await jest.unstable_mockModule('../hooks/useLiquidityPool', () => ({
  useLiquidityPool: mockUseLiquidityPool,
}));

const { default: LiquidityPoolCard } = await import('../components/LiquidityPoolCard');
const { WalletContext } = await import('../contexts/WalletProvider');
const { I18nProvider } = await import('../contexts/I18nProvider');

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const POOL_ID = 'dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7';
const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const samplePool = {
  id: POOL_ID,
  feeBp: 30,
  type: 'constant_product',
  totalTrustlines: '142',
  totalShares: '50000.0000000',
  reserves: [
    { asset: 'native', code: 'XLM', amount: '250000.0000000' },
    { asset: `USDC:${ISSUER}`, code: 'USDC', issuer: ISSUER, amount: '30000.0000000' },
  ],
};

const sampleEstimatedReserves = [
  { asset: 'native', code: 'XLM', amount: '6250.0000000' },
  { asset: `USDC:${ISSUER}`, code: 'USDC', issuer: ISSUER, amount: '750.0000000' },
];

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

const renderCard = (component: ReactNode, walletOverrides: Record<string, unknown> = {}) =>
  render(
    <I18nProvider>
      <WalletContext.Provider value={{ ...baseWalletState, ...walletOverrides }}>
        {component}
      </WalletContext.Provider>
    </I18nProvider>,
  );

const hookState = (overrides: Record<string, unknown> = {}) => ({
  pool: samplePool,
  userShares: '1250.0000000',
  sharePercentage: 2.5,
  estimatedReserves: sampleEstimatedReserves,
  loading: false,
  error: null,
  submitting: false,
  actionError: null,
  refresh: mockRefresh,
  stopPolling: jest.fn(),
  deposit: mockDeposit,
  withdraw: mockWithdraw,
  ...overrides,
});

describe('LiquidityPoolCard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockDeposit.mockResolvedValue(undefined);
    mockWithdraw.mockResolvedValue(undefined);
    mockUseLiquidityPool.mockReturnValue(hookState());
  });

  it('renders an empty state when no poolId is provided', () => {
    mockUseLiquidityPool.mockReturnValue(hookState({ pool: null }));
    renderCard(<LiquidityPoolCard />);

    expect(screen.getByText('No liquidity pool selected')).toBeInTheDocument();
  });

  it('renders a loading skeleton on initial load', () => {
    mockUseLiquidityPool.mockReturnValue(hookState({ pool: null, loading: true }));
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />);

    expect(screen.getByRole('status', { name: 'Loading liquidity pool' })).toBeInTheDocument();
  });

  it('renders an error alert with retry when loading fails', () => {
    mockUseLiquidityPool.mockReturnValue(
      hookState({ pool: null, error: new Error('Horizon unreachable') }),
    );
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Failed to load liquidity pool')).toBeInTheDocument();
    expect(screen.getByText('Horizon unreachable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('displays pool reserves, fee tier, user share, and estimated fiat value', () => {
    const prices: Record<string, number> = { XLM: 0.12, USDC: 1 };
    renderCard(
      <LiquidityPoolCard poolId={POOL_ID} getFiatPrice={({ code }) => prices[code]} />,
    );

    expect(screen.getByRole('region', { name: 'Liquidity pool details' })).toBeInTheDocument();
    expect(screen.getByText('XLM / USDC')).toBeInTheDocument();
    expect(screen.getByText('0.30% fee')).toBeInTheDocument();
    expect(screen.getByText('250,000.00')).toBeInTheDocument();
    expect(screen.getByText('30,000.00')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText(/1,250\.00 shares \(2\.50%\)/)).toBeInTheDocument();
    expect(screen.getByText(/1,500\.00/)).toBeInTheDocument();
    expect(screen.getByText('6,250.00 XLM')).toBeInTheDocument();
    expect(screen.getByText('750.00 USDC')).toBeInTheDocument();
  });

  it('prompts to connect wallet and hides actions when disconnected', () => {
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />, {
      connected: false,
      publicKey: undefined,
    });

    expect(
      screen.getByText(
        'Connect your wallet to view your pool share and deposit or withdraw liquidity.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('validates and submits a deposit', async () => {
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deposit Liquidity' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid amount greater than zero.',
    );
    expect(mockDeposit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('XLM amount'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deposit Liquidity' }));

    await waitFor(() => {
      expect(mockDeposit).toHaveBeenCalledWith({ maxAmountA: '100', maxAmountB: '12' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Deposit submitted successfully.');
  });

  it('switches to withdraw tab, supports Max button, validates, and submits withdrawal', async () => {
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Withdraw' }));
    expect(screen.getByRole('tab', { name: 'Withdraw' })).toHaveAttribute('aria-selected', 'true');

    // Exceeds available shares
    fireEvent.change(screen.getByLabelText('Pool shares to withdraw'), {
      target: { value: '9999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Liquidity' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Amount exceeds your available pool shares.',
    );
    expect(mockWithdraw).not.toHaveBeenCalled();

    // Use Max button and submit
    fireEvent.click(screen.getByRole('button', { name: 'Max' }));
    expect(screen.getByLabelText('Pool shares to withdraw')).toHaveValue(1250);

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw Liquidity' }));
    await waitFor(() => {
      expect(mockWithdraw).toHaveBeenCalledWith({ amount: '1250.0000000' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Withdrawal submitted successfully.');
  });

  it('disables withdraw when user holds zero shares', () => {
    mockUseLiquidityPool.mockReturnValue(
      hookState({ userShares: '0', sharePercentage: 0, estimatedReserves: [] }),
    );
    renderCard(<LiquidityPoolCard poolId={POOL_ID} />);

    expect(
      screen.getByText('You do not currently hold shares in this pool.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Withdraw' }));
    expect(screen.getByRole('button', { name: 'Withdraw Liquidity' })).toBeDisabled();
  });
});
