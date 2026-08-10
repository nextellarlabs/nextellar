/**
 * @jest-environment jsdom
 */
// Registers the DOM matchers locally — jest.config.mjs has no global setup file.
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import TransactionStatusBadge, {
  type TransactionStatus,
} from '../../src/templates/default/src/components/TransactionStatusBadge';

const ALL_STATUSES: TransactionStatus[] = ['pending', 'success', 'failed'];

/** Returns the badge root, which carries the status and styling. */
function getBadge() {
  return screen.getByRole('status');
}

describe('TransactionStatusBadge', () => {
  describe('snapshots', () => {
    it.each(ALL_STATUSES)('renders the %s state consistently', (status) => {
      const { container } = render(<TransactionStatusBadge status={status} />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it('renders the pending state without a spinner consistently', () => {
      const { container } = render(
        <TransactionStatusBadge status="pending" showSpinner={false} />,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('default labels', () => {
    it.each([
      ['pending', 'Pending'],
      ['success', 'Success'],
      ['failed', 'Failed'],
    ] as const)('labels the %s state "%s"', (status, expected) => {
      render(<TransactionStatusBadge status={status} />);
      expect(getBadge()).toHaveTextContent(expected);
    });
  });

  describe('label override', () => {
    it('renders a custom label in place of the default', () => {
      render(<TransactionStatusBadge status="pending" label="Awaiting signature" />);

      expect(getBadge()).toHaveTextContent('Awaiting signature');
      expect(getBadge()).not.toHaveTextContent('Pending');
    });

    it('falls back to the default label when the override is omitted', () => {
      render(<TransactionStatusBadge status="success" />);
      expect(getBadge()).toHaveTextContent('Success');
    });
  });

  describe('accessibility', () => {
    it.each(ALL_STATUSES)(
      'conveys the %s state with text, not colour alone',
      (status) => {
        render(<TransactionStatusBadge status={status} />);

        // A non-empty accessible text node means the badge is still readable
        // when colour is unavailable (colour blindness, monochrome, forced
        // colours). This is the core acceptance criterion for the component.
        expect(getBadge().textContent?.trim()).not.toHaveLength(0);
      },
    );

    it.each(ALL_STATUSES)('exposes the %s state as a live region', (status) => {
      render(<TransactionStatusBadge status={status} />);
      expect(getBadge()).toBeInTheDocument();
    });

    it.each(ALL_STATUSES)('pairs the %s state with an icon', (status) => {
      const { container } = render(<TransactionStatusBadge status={status} />);

      const icon = container.querySelector('svg');
      expect(icon).not.toBeNull();
      // Decorative: the adjacent text already names the status, so announcing
      // the icon too would be redundant.
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('marks the machine-readable status separately from the label', () => {
      // A custom label must not hide which state the badge represents.
      render(<TransactionStatusBadge status="failed" label="Rejected" />);
      expect(getBadge()).toHaveAttribute('data-status', 'failed');
    });
  });

  describe('distinct status styling', () => {
    it('gives each status a different colour treatment', () => {
      const classNames = ALL_STATUSES.map((status) => {
        const { container } = render(<TransactionStatusBadge status={status} />);
        return (container.firstChild as HTMLElement).className;
      });

      expect(new Set(classNames).size).toBe(ALL_STATUSES.length);
    });

    it.each([
      ['pending', 'amber'],
      ['success', 'green'],
      ['failed', 'red'],
    ] as const)('uses the %s → %s palette', (status, hue) => {
      render(<TransactionStatusBadge status={status} />);
      expect(getBadge().className).toContain(hue);
    });

    it.each(ALL_STATUSES)('ships a dark-theme variant for %s', (status) => {
      render(<TransactionStatusBadge status={status} />);

      // Every colour utility needs a dark: counterpart, otherwise the badge
      // renders light-on-light in dark mode.
      expect(getBadge().className).toContain('dark:');
    });
  });

  describe('icon selection', () => {
    it('animates the pending state by default', () => {
      const { container } = render(<TransactionStatusBadge status="pending" />);
      expect(container.querySelector('svg')).toHaveClass('animate-spin');
    });

    it('uses a static icon when the spinner is disabled', () => {
      const { container } = render(
        <TransactionStatusBadge status="pending" showSpinner={false} />,
      );
      expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
    });

    it.each(['success', 'failed'] as const)(
      'never animates the settled %s state',
      (status) => {
        const { container } = render(<TransactionStatusBadge status={status} />);
        expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
      },
    );

    it('ignores showSpinner for settled states', () => {
      const { container } = render(
        <TransactionStatusBadge status="success" showSpinner={false} />,
      );
      expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
    });
  });

  describe('className passthrough', () => {
    it('merges custom classes onto the badge root', () => {
      render(<TransactionStatusBadge status="success" className="ml-2 shadow" />);

      const badge = getBadge();
      expect(badge).toHaveClass('ml-2', 'shadow');
      // Composition must not drop the component's own styling.
      expect(badge).toHaveClass('inline-flex');
    });

    it('renders without stray whitespace when no className is given', () => {
      render(<TransactionStatusBadge status="success" />);
      expect(getBadge().className).toBe(getBadge().className.trim());
    });
  });
});
