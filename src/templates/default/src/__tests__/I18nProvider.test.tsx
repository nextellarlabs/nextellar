/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, act, waitFor } from '@testing-library/react';

// Mock storage the same way ThemeProvider.test.tsx does, so persistence is
// verifiable without touching real localStorage across test runs.
const mockStorage = new Map<string, string>();
await jest.unstable_mockModule('../lib/storage', () => ({
  storage: {
    get: (key: string) => mockStorage.get(key) ?? null,
    set: (key: string, value: string) => mockStorage.set(key, value),
    remove: (key: string) => mockStorage.delete(key),
  },
}));

const { I18nProvider, useTranslation, locales } = await import('../contexts/I18nProvider');

function Probe() {
  const { locale, t, setLocale, availableLocales } = useTranslation();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t('home.title')}</span>
      <span data-testid="interpolated">{t('wallet.connected', { address: 'GABC…WXYZ' })}</span>
      <span data-testid="missing-token">{t('wallet.balance', { amount: '10' })}</span>
      <span data-testid="available">{availableLocales.join(',')}</span>
      <button onClick={() => setLocale('en')}>use-en</button>
    </div>
  );
}

describe('I18nProvider', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('defaults to en when nothing is persisted', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
    });
  });

  it('resolves a message by dot-path', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('title')).toHaveTextContent(locales.en.home.title);
    });
  });

  it('interpolates {token} placeholders with supplied params', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('interpolated')).toHaveTextContent('GABC…WXYZ');
    });
  });

  it('leaves an unmatched {token} placeholder untouched rather than throwing', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    // wallet.balance is "Balance: {amount} {asset}" — only {amount} is supplied.
    await waitFor(() => {
      expect(screen.getByTestId('missing-token')).toHaveTextContent('Balance: 10 {asset}');
    });
  });

  it('returns the raw path when the key does not resolve to a string', async () => {
    function BadPathProbe() {
      const { t } = useTranslation();
      // @ts-expect-error -- intentionally an invalid path to exercise the fallback
      return <span data-testid="bad">{t('does.not.exist')}</span>;
    }

    render(
      <I18nProvider>
        <BadPathProbe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('bad')).toHaveTextContent('does.not.exist');
    });
  });

  it('persists the chosen locale', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await act(async () => {
      screen.getByText('use-en').click();
    });

    expect(mockStorage.get('nextellar_locale')).toBe('en');
  });

  it('loads a persisted locale on mount', async () => {
    mockStorage.set('nextellar_locale', 'en');

    render(
      <I18nProvider defaultLocale="en">
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
    });
  });

  it('ignores a corrupted persisted value and falls back to defaultLocale', async () => {
    mockStorage.set('nextellar_locale', 'not-a-real-locale');

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
    });
  });

  it('lists every registered locale', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('available')).toHaveTextContent('en');
    });
  });

  it('throws a clear error when useTranslation is used outside the provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    function Orphan() {
      useTranslation();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow('useTranslation must be used within an I18nProvider');
    consoleError.mockRestore();
  });
});
