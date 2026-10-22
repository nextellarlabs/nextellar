/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from '../components/ThemeToggle';
import { ThemeContext } from '../contexts/ThemeProvider';

describe('ThemeToggle', () => {
  const mockSetTheme = jest.fn();

  const renderWithTheme = (theme: 'light' | 'dark' | 'system' = 'system') => {
    return render(
      <ThemeContext.Provider value={{ theme, resolvedTheme: 'light', setTheme: mockSetTheme }}>
        <ThemeToggle />
      </ThemeContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders one option per theme', () => {
    renderWithTheme();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
  });

  it('marks the current theme as checked', () => {
    renderWithTheme('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls setTheme with the clicked option', () => {
    renderWithTheme('system');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('calling setTheme for light and system works independently', () => {
    renderWithTheme('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('exposes a radiogroup for screen readers', () => {
    renderWithTheme();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });
});
