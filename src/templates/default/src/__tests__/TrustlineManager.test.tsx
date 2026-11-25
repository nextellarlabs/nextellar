/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { createContext, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { I18nProvider } from '../contexts/I18nProvider';
import type { TrustlinesState } from '../hooks/useTrustlines';

expect.extend(toHaveNoViolations);

const VALID_PUBLIC_KEY = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const VALID_ISSUER_1 = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const VALID_ISSUER_2 = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const MockWalletContext = createContext<Record<string, unknown> | undefined>(undefined);
const mockUseTrustlines = jest.fn<() => TrustlinesState>();

jest.unstable_mockModule('../contexts/WalletProvider', () => ({
  WalletContext: MockWalletContext,
}));

jest.unstable_mockModule('../hooks/useTrustlines', () => ({
  useTrustlines: (...args: unknown[]) => mockUseTrustlines(...(args as [])),
}));

const { default: TrustlineManager, hasNonZeroBalance } = await import(
  '../components/TrustlineManager'
);

describe('TrustlineManager Component', () => {
  const mockRefresh = jest.fn<() => Promise<void>>();
  const mockBuildChangeTrustXDR =
    jest.fn<(asset: { code: string; issuer: string; limit?: string }) => Promise<string>>();
  const mockSubmitWithSecret = jest.fn<TrustlinesState['submitChangeTrustWithSecret']>();

  const baseTrustlinesState = (): TrustlinesState => ({
    trustlines: [
      {
        asset_code: 'USDC',
        asset_issuer: VALID_ISSUER_1,
        balance: '42.5000000',
        limit: '1000000',
        authorized: true,
      },
      {
        asset_code: 'EURC',
        asset_issuer: VALID_ISSUER_2,
        balance: '0.0000000',
        limit: '500000',
        authorized: true,
      },
    ],
    loading: false,
    error: null,
    refresh: mockRefresh,
    buildChangeTrustXDR: mockBuildChangeTrustXDR,
    submitChangeTrustWithSecret: mockSubmitWithSecret,
  });

  const baseWalletState = {
    connected: true,
    publicKey: VALID_PUBLIC_KEY,
    walletName: 'Freighter',
    balances: [],
    accounts: [],
    connect: jest.fn(),
    disconnect: jest.fn(),
    refreshBalances: jest.fn(),
    switchAccount: jest.fn(),
    currentAccountIndex: 0,
    sendPayment: jest.fn(),
  };

  const renderComponent = (
    ui: ReactNode,
    walletOverrides: Record<string, unknown> = {},
  ) =>
    render(
      <I18nProvider>
        <MockWalletContext.Provider value={{ ...baseWalletState, ...walletOverrides }}>
          {ui}
        </MockWalletContext.Provider>
      </I18nProvider>,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    mockBuildChangeTrustXDR.mockResolvedValue('AAAA_MOCK_UNSIGNED_XDR');
    mockUseTrustlines.mockReturnValue(baseTrustlinesState());
  });

  it('hasNonZeroBalance accurately detects positive vs zero balances', () => {
    expect(hasNonZeroBalance(undefined)).toBe(false);
    expect(hasNonZeroBalance('0')).toBe(false);
    expect(hasNonZeroBalance('0.0000000')).toBe(false);
    expect(hasNonZeroBalance('0.0000001')).toBe(true);
    expect(hasNonZeroBalance('100')).toBe(true);
  });

  it('disables inputs and shows connect prompt when no wallet is connected', () => {
    mockUseTrustlines.mockReturnValue({
      ...baseTrustlinesState(),
      trustlines: [],
    });

    renderComponent(<TrustlineManager />, { connected: false, publicKey: undefined });

    expect(screen.getByText(/connect a wallet to manage trustlines/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Asset Code')).toBeDisabled();
    expect(screen.getByLabelText('Asset Issuer')).toBeDisabled();
    expect(screen.getByRole('button', { name: /add trustline/i })).toBeDisabled();
  });

  it('renders trustlines, reserve summary, and reserve impact for add and remove', () => {
    renderComponent(<TrustlineManager />);

    expect(screen.getByTestId('trustline-reserve-summary')).toHaveTextContent(
      '2 active trustlines (1.0 XLM reserved)',
    );
    expect(screen.getByTestId('add-reserve-impact')).toHaveTextContent(
      'Reserve impact: +0.5 XLM minimum balance',
    );
    expect(screen.getAllByText(/reserve impact: -0\.5 xlm freed/i)).toHaveLength(2);
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText('EURC')).toBeInTheDocument();
  });

  it('blocks removal of non-zero balance trustlines and allows removing zero-balance trustlines', async () => {
    const onSignAndSubmit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderComponent(<TrustlineManager onSignAndSubmit={onSignAndSubmit} />);

    const removeUsdcBtn = screen.getByRole('button', { name: 'Remove USDC trustline' });
    const removeEurcBtn = screen.getByRole('button', { name: 'Remove EURC trustline' });

    expect(removeUsdcBtn).toBeDisabled();
    expect(
      screen.getByText(/balance must be 0 before removing this trustline/i),
    ).toBeInTheDocument();

    expect(removeEurcBtn).toBeEnabled();
    fireEvent.click(removeEurcBtn);

    await waitFor(() => {
      expect(mockBuildChangeTrustXDR).toHaveBeenCalledWith({
        code: 'EURC',
        issuer: VALID_ISSUER_2,
        limit: '0',
      });
      expect(onSignAndSubmit).toHaveBeenCalledWith('AAAA_MOCK_UNSIGNED_XDR', {
        type: 'remove',
        assetCode: 'EURC',
        assetIssuer: VALID_ISSUER_2,
        limit: '0',
      });
      expect(mockRefresh).toHaveBeenCalled();
    });

    expect(await screen.findByText(/trustline for eurc removed/i)).toBeInTheDocument();
  });

  it('validates asset code, issuer, limit, and duplicate trustlines', () => {
    renderComponent(<TrustlineManager />);

    fireEvent.change(screen.getByLabelText('Asset Code'), { target: { value: 'BAD_CODE!' } });
    fireEvent.change(screen.getByLabelText('Asset Issuer'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText('Trust Limit (optional)'), { target: { value: '-10' } });

    expect(screen.getByText(/1–12 alphanumeric characters/i)).toBeInTheDocument();
    expect(screen.getByText(/valid stellar issuer public key/i)).toBeInTheDocument();
    expect(screen.getByText(/must be a positive number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add trustline/i })).toBeDisabled();

    // Duplicate check
    fireEvent.change(screen.getByLabelText('Asset Code'), { target: { value: 'USDC' } });
    fireEvent.change(screen.getByLabelText('Asset Issuer'), { target: { value: VALID_ISSUER_1 } });
    fireEvent.change(screen.getByLabelText('Trust Limit (optional)'), { target: { value: '' } });

    expect(screen.getByText(/trustline for this asset already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add trustline/i })).toBeDisabled();
  });

  it('builds XDR and shows unsigned XDR when onSignAndSubmit is not provided', async () => {
    renderComponent(<TrustlineManager />);

    fireEvent.change(screen.getByLabelText('Asset Code'), { target: { value: 'BTC' } });
    fireEvent.change(screen.getByLabelText('Asset Issuer'), { target: { value: VALID_ISSUER_2 } });
    fireEvent.change(screen.getByLabelText('Trust Limit (optional)'), {
      target: { value: '100' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add trustline/i }));

    await waitFor(() => {
      expect(mockBuildChangeTrustXDR).toHaveBeenCalledWith({
        code: 'BTC',
        issuer: VALID_ISSUER_2,
        limit: '100',
      });
    });

    expect(await screen.findByText('Unsigned Transaction XDR Ready')).toBeInTheDocument();
    expect(screen.getByText('AAAA_MOCK_UNSIGNED_XDR')).toBeInTheDocument();
  });

  it('shows error state and retries when refresh is clicked', () => {
    mockUseTrustlines.mockReturnValue({
      ...baseTrustlinesState(),
      trustlines: [],
      error: new Error('Horizon unavailable'),
    });

    renderComponent(<TrustlineManager />);

    expect(screen.getByRole('alert')).toHaveTextContent(/horizon unavailable/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderComponent(<TrustlineManager />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
