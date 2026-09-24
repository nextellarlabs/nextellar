/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

import ContractCallPreview, {
  type SimulationPreview,
} from '../../src/templates/default/src/components/ContractCallPreview';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PREVIEW: SimulationPreview = {
  result: 'ok',
  minResourceFee: '500',
  latestLedger: 9999,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPreviewSection() {
  return screen.getByRole('region', { name: /simulation preview/i });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContractCallPreview', () => {
  // ── Empty / null states ───────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders nothing when no preview, not loading, and no error', () => {
      const { container } = render(<ContractCallPreview />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when preview is undefined and other props are defaults', () => {
      const { container } = render(
        <ContractCallPreview preview={undefined} loading={false} error={null} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('renders a live region with accessible label while loading', () => {
      render(<ContractCallPreview loading={true} />);

      const region = screen.getByRole('status', { name: /simulating contract call/i });
      expect(region).toBeInTheDocument();
    });

    it('shows the "Simulating transaction…" text', () => {
      render(<ContractCallPreview loading={true} />);
      expect(screen.getByText(/Simulating transaction/i)).toBeInTheDocument();
    });

    it('renders the spinner SVG with aria-hidden', () => {
      const { container } = render(<ContractCallPreview loading={true} />);
      const spinner = container.querySelector('svg.animate-spin');
      expect(spinner).not.toBeNull();
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders skeleton placeholder rows', () => {
      const { container } = render(<ContractCallPreview loading={true} />);
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThanOrEqual(1);
    });

    it('does not render the preview section or error while loading', () => {
      render(<ContractCallPreview loading={true} preview={BASE_PREVIEW} />);
      expect(screen.queryByRole('region', { name: /simulation preview/i })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('accepts className override in loading state', () => {
      const { container } = render(
        <ContractCallPreview loading={true} className="mt-4" />
      );
      expect(container.firstChild).toHaveClass('mt-4');
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────

  describe('error state', () => {
    const err = new Error('Simulation failed: contract reverted with panic');

    it('renders an alert region', () => {
      render(<ContractCallPreview error={err} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('displays "Simulation failed" heading', () => {
      render(<ContractCallPreview error={err} />);
      // Use getAllByText because the error message itself also contains "Simulation failed:"
      const matches = screen.getAllByText(/Simulation failed/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('displays the error message', () => {
      render(<ContractCallPreview error={err} />);
      expect(screen.getByText(/contract reverted with panic/i)).toBeInTheDocument();
    });

    it('renders a "Go back" button when onCancel is provided', () => {
      const onCancel = jest.fn();
      render(<ContractCallPreview error={err} onCancel={onCancel} />);
      expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    });

    it('calls onCancel when "Go back" is clicked', () => {
      const onCancel = jest.fn();
      render(<ContractCallPreview error={err} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: /go back/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not render the "Go back" button when onCancel is absent', () => {
      render(<ContractCallPreview error={err} />);
      expect(screen.queryByRole('button', { name: /go back/i })).toBeNull();
    });

    it('does not render the preview section when there is an error', () => {
      render(
        <ContractCallPreview error={err} preview={BASE_PREVIEW} />
      );
      expect(screen.queryByRole('region', { name: /simulation preview/i })).toBeNull();
    });

    it('accepts className override in error state', () => {
      const { container } = render(
        <ContractCallPreview error={err} className="border-2" />
      );
      expect(container.firstChild).toHaveClass('border-2');
    });
  });

  // ── Preview data ──────────────────────────────────────────────────────────

  describe('preview data', () => {
    it('renders the "Simulation Preview" heading', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(
        screen.getByRole('heading', { name: /simulation preview/i })
      ).toBeInTheDocument();
    });

    it('displays the fee in stroops', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(screen.getByText('500')).toBeInTheDocument();
      expect(screen.getByText(/stroops/i)).toBeInTheDocument();
    });

    it('converts fee to XLM (500 stroops = 0.0000500 XLM)', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      // 500 / 10_000_000 = 0.0000500 XLM
      expect(screen.getByText(/0\.0000500/)).toBeInTheDocument();
      expect(screen.getByText(/XLM/)).toBeInTheDocument();
    });

    it('converts a larger fee correctly (10_000_000 stroops = 1 XLM)', () => {
      render(
        <ContractCallPreview
          preview={{ ...BASE_PREVIEW, minResourceFee: '10000000' }}
        />
      );
      expect(screen.getByText(/1\.0000000/)).toBeInTheDocument();
    });

    it('displays the string return value', () => {
      render(<ContractCallPreview preview={{ ...BASE_PREVIEW, result: 'ok' }} />);
      expect(screen.getByText(/"ok"/)).toBeInTheDocument();
    });

    it('displays "(void)" for a null return value', () => {
      render(<ContractCallPreview preview={{ ...BASE_PREVIEW, result: null }} />);
      expect(screen.getByText('(void)')).toBeInTheDocument();
    });

    it('displays a numeric return value', () => {
      render(<ContractCallPreview preview={{ ...BASE_PREVIEW, result: 42 }} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('displays a boolean return value', () => {
      render(<ContractCallPreview preview={{ ...BASE_PREVIEW, result: true }} />);
      expect(screen.getByText('true')).toBeInTheDocument();
    });

    it('displays the latestLedger', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      // 9999 → "#9,999" with toLocaleString, but the exact format depends on locale
      expect(screen.getByText(/#9/)).toBeInTheDocument();
    });

    it('displays "Simulated at ledger" label', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(screen.getByText(/Simulated at ledger/i)).toBeInTheDocument();
    });

    it('displays "Estimated fee" label', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(screen.getByText(/Estimated fee/i)).toBeInTheDocument();
    });

    it('displays "Return value" label', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(screen.getByText(/Return value/i)).toBeInTheDocument();
    });
  });

  // ── Action buttons ────────────────────────────────────────────────────────

  describe('action buttons', () => {
    it('renders Confirm & Submit button when onConfirm provided', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} onConfirm={jest.fn()} />);
      expect(
        screen.getByRole('button', { name: /confirm.*submit/i })
      ).toBeInTheDocument();
    });

    it('calls onConfirm when Confirm & Submit is clicked', () => {
      const onConfirm = jest.fn();
      render(<ContractCallPreview preview={BASE_PREVIEW} onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole('button', { name: /confirm.*submit/i }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('renders Cancel button when onCancel provided', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} onCancel={jest.fn()} />);
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    it('calls onCancel when Cancel is clicked', () => {
      const onCancel = jest.fn();
      render(<ContractCallPreview preview={BASE_PREVIEW} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders both buttons when both callbacks are provided', () => {
      render(
        <ContractCallPreview
          preview={BASE_PREVIEW}
          onConfirm={jest.fn()}
          onCancel={jest.fn()}
        />
      );
      expect(screen.getByRole('button', { name: /confirm.*submit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    it('renders no action buttons when neither callback is provided', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders only the Confirm button when onCancel is absent', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} onConfirm={jest.fn()} />);
      expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();
    });

    it('renders only the Cancel button when onConfirm is absent', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} onCancel={jest.fn()} />);
      expect(screen.queryByRole('button', { name: /confirm.*submit/i })).toBeNull();
    });
  });

  // ── className passthrough ─────────────────────────────────────────────────

  describe('className passthrough', () => {
    it('applies extra classes to the section in preview state', () => {
      const { container } = render(
        <ContractCallPreview preview={BASE_PREVIEW} className="mt-6" />
      );
      expect(container.firstChild).toHaveClass('mt-6');
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('preview section uses <section> with aria-label', () => {
      const { container } = render(<ContractCallPreview preview={BASE_PREVIEW} />);
      const section = container.querySelector('section[aria-label]');
      expect(section).not.toBeNull();
      expect(section?.getAttribute('aria-label')).toMatch(/simulation preview/i);
    });

    it('error state uses role="alert"', () => {
      render(<ContractCallPreview error={new Error('oops')} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('loading state uses role="status" with aria-live="polite"', () => {
      const { container } = render(<ContractCallPreview loading={true} />);
      const el = container.querySelector('[role="status"]');
      expect(el).toHaveAttribute('aria-live', 'polite');
    });

    it('icons carry aria-hidden in the preview section', () => {
      render(<ContractCallPreview preview={BASE_PREVIEW} />);
      // No icons in the preview section — just confirming no un-hidden SVG breaks a11y
      const { container } = render(
        <ContractCallPreview loading={true} />
      );
      const svgs = container.querySelectorAll('svg');
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  // ── Result formatting edge cases ──────────────────────────────────────────

  describe('result formatting', () => {
    it('renders undefined result as "(void)"', () => {
      render(
        <ContractCallPreview preview={{ ...BASE_PREVIEW, result: undefined }} />
      );
      expect(screen.getByText('(void)')).toBeInTheDocument();
    });

    it('renders object result as JSON', () => {
      render(
        <ContractCallPreview preview={{ ...BASE_PREVIEW, result: { a: 1 } }} />
      );
      expect(screen.getByText(/\{"a":1\}/)).toBeInTheDocument();
    });

    it('renders array result as JSON', () => {
      render(
        <ContractCallPreview
          preview={{ ...BASE_PREVIEW, result: [1, 2, 3] }}
        />
      );
      expect(screen.getByText(/\[1,2,3\]/)).toBeInTheDocument();
    });
  });
});
