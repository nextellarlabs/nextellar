/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { expect, it, jest } from '@jest/globals';
import { I18nProvider } from '../contexts/I18nProvider';
import type { Offer } from '../hooks/useOfferBook';

const useOfferBook = jest.fn();
jest.unstable_mockModule('../hooks/useOfferBook', () => ({ useOfferBook }));
const { OrderBookTable } = await import('../components/OrderBookTable');

const buying = 'XLM';
const selling = { code: 'USD', issuer: 'G' };
const offer = (price: string, amount: string): Offer => ({ price, amount, seller: '', buying, selling });

function renderBook() {
  return render(<I18nProvider><OrderBookTable buying={buying} selling={selling} /></I18nProvider>);
}

it('sorts the two sides, computes spread from the best prices and shows cumulative depth', () => {
  useOfferBook.mockReturnValue({
    bids: [offer('0.9', '6'), offer('1', '2')],
    asks: [offer('1.3', '9'), offer('1.1', '3')],
    loading: false,
    error: null,
  });
  renderBook();

  expect(useOfferBook).toHaveBeenCalledWith(buying, selling, undefined);
  expect(screen.getByText('Spread: 0.1')).toBeInTheDocument();
  const bids = within(screen.getByRole('table', { name: 'Bids' }));
  const [, firstBid, secondBid] = bids.getAllByRole('row');
  expect(within(firstBid).getByText('1')).toBeInTheDocument();
  expect(within(secondBid).getByText('8')).toBeInTheDocument();
  expect(bids.getByRole('columnheader', { name: 'Cumulative depth' })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Asks' })).toBeInTheDocument();
});

it('shows unavailable spread and empty sides', () => {
  useOfferBook.mockReturnValue({ bids: [], asks: [], loading: false, error: null });
  renderBook();
  expect(screen.getByText('Spread unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('No offers')).toHaveLength(2);
});

it('announces loading and errors', () => {
  useOfferBook.mockReturnValue({ bids: [], asks: [], loading: true, error: new Error() });
  renderBook();
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load the order book');
});
