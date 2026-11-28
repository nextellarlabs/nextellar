/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { xdr } from '@stellar/stellar-sdk';
import type { SorobanEvent } from '../hooks/useSorobanEvents';

const mockUseSorobanEvents = jest.fn();
const mockUseContractEventHistory = jest.fn();
const mockRefresh = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockStopPolling = jest.fn();
const mockFetchNextPage = jest.fn<() => Promise<undefined>>().mockResolvedValue(undefined);
const mockReset = jest.fn();

await jest.unstable_mockModule('../hooks/useSorobanEvents', () => ({
  useSorobanEvents: mockUseSorobanEvents,
}));

await jest.unstable_mockModule('../hooks/useContractEventHistory', () => ({
  useContractEventHistory: mockUseContractEventHistory,
}));

const { default: ContractEventFeed } = await import('../components/ContractEventFeed');
const { I18nProvider } = await import('../contexts/I18nProvider');

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const sym = (s: string) => xdr.ScVal.scvSymbol(s).toXDR('base64');
const str = (s: string) => xdr.ScVal.scvString(s).toXDR('base64');
const u32 = (n: number) => xdr.ScVal.scvU32(n).toXDR('base64');

function buildEvent(
  id: string,
  ledger: number,
  topicName: string,
  valueNum: number,
  success = true
): SorobanEvent {
  return {
    id,
    type: 'contract',
    ledger,
    ledgerClosedAt: '2026-01-15T12:00:00Z',
    contractId: CONTRACT_ID,
    topic: [sym(topicName), str('GABC1234')],
    value: u32(valueNum),
    txHash: `abcdef1234567890abcdef1234567890${id}`,
    inSuccessfulContractCall: success,
  };
}

const liveHookState = (overrides: Record<string, unknown> = {}) => ({
  events: [] as SorobanEvent[],
  loading: false,
  refresh: mockRefresh,
  stopPolling: mockStopPolling,
  error: null,
  isRecovering: false,
  ...overrides,
});

const historyHookState = (overrides: Record<string, unknown> = {}) => ({
  events: [] as SorobanEvent[],
  loading: false,
  error: null,
  isDone: false,
  fetchNextPage: mockFetchNextPage,
  reset: mockReset,
  ...overrides,
});

describe('ContractEventFeed Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSorobanEvents.mockReturnValue(liveHookState());
    mockUseContractEventHistory.mockReturnValue(historyHookState());
  });

  it('shows a loading state on initial load', () => {
    mockUseSorobanEvents.mockReturnValue(liveHookState({ loading: true }));

    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    expect(screen.getByRole('status', { name: 'Loading contract events' })).toBeInTheDocument();
  });

  it('shows an empty state when no events exist', () => {
    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    expect(screen.getByText('No contract events yet')).toBeInTheDocument();
  });

  it('renders an error alert with a retry button', () => {
    mockUseSorobanEvents.mockReturnValue(
      liveHookState({ error: new Error('RPC timeout') })
    );

    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Failed to load contract events')).toBeInTheDocument();
    expect(screen.getByText('RPC timeout')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('decodes and displays events from both useSorobanEvents and useContractEventHistory', () => {
    const liveEvt = buildEvent('evt-2', 200, 'transfer', 42);
    const historyEvt = buildEvent('evt-1', 150, 'mint', 99, false);

    mockUseSorobanEvents.mockReturnValue(liveHookState({ events: [liveEvt] }));
    mockUseContractEventHistory.mockReturnValue(
      historyHookState({ events: [historyEvt, liveEvt] }) // includes duplicate to verify dedup
    );

    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveAttribute('aria-posinset', '1');
    expect(articles[0]).toHaveAttribute('aria-setsize', '2');

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('filters events by topic pill and search input', () => {
    const transferEvt = buildEvent('evt-1', 200, 'transfer', 100);
    const mintEvt = buildEvent('evt-2', 199, 'mint', 200);
    mockUseSorobanEvents.mockReturnValue(liveHookState({ events: [transferEvt, mintEvt] }));

    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    // Click the "mint" topic pill
    const mintPill = screen.getByRole('button', { name: 'mint' });
    fireEvent.click(mintPill);
    expect(mintPill).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();

    // Clear filter restores all events
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);

    // Search input filters by topic substring
    const searchInput = screen.getByRole('searchbox', { name: 'Filter events by topic' });
    fireEvent.change(searchInput, { target: { value: 'trans' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('100')).toBeInTheDocument();

    // Non-matching search shows filtered empty state
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No matching events')).toBeInTheDocument();
  });

  it('supports pausing/resuming live feed and loading earlier historical pages', () => {
    render(
      <I18nProvider>
        <ContractEventFeed contractId={CONTRACT_ID} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause live feed' }));
    expect(mockStopPolling).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Paused')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume live feed' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Live')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier events' }));
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('virtualizes long event feeds so only a small window of rows is rendered', () => {
    const manyEvents = Array.from({ length: 200 }, (_, i) =>
      buildEvent(`evt-${String(i).padStart(4, '0')}`, 1000 + i, 'transfer', i + 1)
    );
    mockUseSorobanEvents.mockReturnValue(liveHookState({ events: manyEvents }));

    render(
      <I18nProvider>
        <ContractEventFeed
          contractId={CONTRACT_ID}
          height={400}
          itemHeight={100}
          overscan={2}
        />
      </I18nProvider>
    );

    // Viewport fits 4 items + 2 overscan = 6 rendered out of 200
    const initialArticles = screen.getAllByRole('article');
    expect(initialArticles.length).toBeLessThan(20);
    expect(initialArticles[0]).toHaveAttribute('aria-setsize', '200');
    expect(initialArticles[0]).toHaveAttribute('aria-posinset', '1');

    // Scrolling updates the rendered window
    const feed = screen.getByRole('feed', { name: 'Decoded contract events' });
    fireEvent.scroll(feed, { target: { scrollTop: 5000 } });

    const scrolledArticles = screen.getAllByRole('article');
    expect(Number(scrolledArticles[0].getAttribute('aria-posinset'))).toBeGreaterThan(40);
  });

  it('works without I18nProvider by falling back to English locale strings', () => {
    render(<ContractEventFeed contractId={CONTRACT_ID} />);
    expect(screen.getByText('Contract Events')).toBeInTheDocument();
  });
});
