'use client';

import { useTranslation } from '../contexts/I18nProvider';
import { useOfferBook, type Offer } from '../hooks/useOfferBook';

type Book = ReturnType<typeof useOfferBook>;
type Asset = Parameters<typeof useOfferBook>[0];

export interface OrderBookTableProps {
  buying: Asset;
  selling: Asset;
  options?: Parameters<typeof useOfferBook>[2];
}

function depthLevels(offers: Offer[], descending: boolean) {
  let depth = 0;
  return [...offers]
    .filter(({ price, amount }) =>
      [price, amount].every(value => Number.isFinite(Number(value)) && Number(value) > 0),
    )
    .sort((a, b) => (descending ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price)))
    .map(offer => {
      depth += Number(offer.amount);
      return { ...offer, depth };
    });
}

export function OrderBookView({ bids, asks, loading, error }: Pick<Book, 'bids' | 'asks' | 'loading' | 'error'>) {
  const { t, locale } = useTranslation();
  const bidLevels = depthLevels(bids, true);
  const askLevels = depthLevels(asks, false);
  const maxDepth = Math.max(bidLevels.at(-1)?.depth ?? 0, askLevels.at(-1)?.depth ?? 0);
  const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 12 });
  const spread = bidLevels[0] && askLevels[0]
    ? Number(askLevels[0].price) - Number(bidLevels[0].price)
    : undefined;

  return (
    <section aria-label={t('orderBook.title')} aria-busy={loading} className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
      <h3 className="text-sm font-semibold">{t('orderBook.title')}</h3>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{t('orderBook.error')}</p>}
      {loading && <p role="status">{t('common.loading')}</p>}
      <p className="mb-3 text-sm">
        {spread === undefined ? t('orderBook.unavailableSpread') : t('orderBook.spread', { value: number.format(spread) })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          { side: 'bids', levels: bidLevels, fill: 'bg-emerald-600 dark:bg-emerald-400' },
          { side: 'asks', levels: askLevels, fill: 'bg-rose-600 dark:bg-rose-400' },
        ] as const).map(({ side, levels, fill }) => (
          <div key={side} className="min-w-0 overflow-x-auto">
            <table className="w-full text-right text-sm tabular-nums">
              <caption className="mb-1 text-left font-semibold">{t(`orderBook.${side}`)}</caption>
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th scope="col" className="p-1">{t('orderBook.price')}</th>
                  <th scope="col" className="p-1">{t('orderBook.amount')}</th>
                  <th scope="col" className="p-1">{t('orderBook.depth')}</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((row, index) => (
                  <tr key={`${row.price}-${index}`}>
                    <td className="p-1">{number.format(Number(row.price))}</td>
                    <td className="p-1">{number.format(Number(row.amount))}</td>
                    <td className="p-1">
                      <span>{number.format(row.depth)}</span>
                      <span aria-hidden="true" className={`block h-1 rounded ${fill}`} style={{ width: `${(row.depth / maxDepth) * 100}%` }} />
                    </td>
                  </tr>
                ))}
                {!loading && !error && levels.length === 0 && (
                  <tr><td colSpan={3} className="py-2 text-center">{t('orderBook.empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OrderBookTable({ buying, selling, options }: OrderBookTableProps) {
  const book = useOfferBook(buying, selling, options);
  return <OrderBookView {...book} />;
}
