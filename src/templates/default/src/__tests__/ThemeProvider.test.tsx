/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, act, waitFor } from '@testing-library/react';

// Mock storage the same way WalletProvider.test.tsx does, so persistence is
// verifiable without touching real localStorage across test runs.
const mockStorage = new Map<string, string>();
await jest.unstable_mockModule('../lib/storage', () => ({
  storage: {
    get: (key: string) => mockStorage.get(key) ?? null,
    set: (key: string, value: string) => mockStorage.set(key, value),
    remove: (key: string) => mockStorage.delete(key),
  },
}));

const { ThemeProvider, useTheme } = await import('../contexts/ThemeProvider');

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

function mockMatchMedia(matchesDark: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? matchesDark : false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    mockStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
  });

  it('defaults to system when nothing is persisted', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('system');
    });
  });

  it('resolves system to light when the OS prefers light', async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves system to dark when the OS prefers dark', async () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setting theme to dark applies the .dark class and persists the choice', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'dark' }).click();
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(mockStorage.get('nextellar_theme')).toBe('dark');
  });

  it('setting theme to light removes the .dark class and persists the choice', async () => {
    document.documentElement.classList.add('dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'light' }).click();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(mockStorage.get('nextellar_theme')).toBe('light');
  });

  it('loads a previously persisted choice on mount', async () => {
    mockStorage.set('nextellar_theme', 'dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('throws when useTheme is used outside a ThemeProvider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme must be used within a ThemeProvider');
    consoleError.mockRestore();
  });
});
