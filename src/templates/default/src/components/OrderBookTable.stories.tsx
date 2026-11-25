import type { Meta, StoryObj } from '@storybook/react';
import { I18nProvider } from '../contexts/I18nProvider';
import type { Offer } from '../hooks/useOfferBook';
import { OrderBookView } from './OrderBookTable';

const offer = (price: string, amount: string): Offer => ({
  price,
  amount,
  seller: '',
  buying: 'XLM',
  selling: { code: 'USD', issuer: 'G' },
});

const meta = {
  title: 'Components/OrderBookTable',
  component: OrderBookView,
  decorators: [(Story) => <I18nProvider><Story /></I18nProvider>],
  args: { loading: false, error: null, bids: [], asks: [] },
} satisfies Meta<typeof OrderBookView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  args: {
    bids: [offer('0.25', '10'), offer('0.24', '20')],
    asks: [offer('0.26', '12'), offer('0.27', '25')],
  },
};
export const Empty: Story = {};
export const Loading: Story = { args: { loading: true } };
