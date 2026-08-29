'use client';

// Simple inline SVG icons — status is never conveyed by colour alone.
const SpinnerIcon = () => (
  <svg
    className="w-3.5 h-3.5 animate-spin"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const ClockIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export type TransactionStatus = 'pending' | 'success' | 'failed';

/**
 * Per-status presentation. Colours are paired with a distinct icon and text
 * label so the badge stays legible for colour-blind users and in monochrome.
 * Each palette is tuned for both light and dark backgrounds.
 */
const STATUS_STYLES: Record<
  TransactionStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'Pending',
    className:
      'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30',
  },
  success: {
    label: 'Success',
    className:
      'bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-400/30',
  },
  failed: {
    label: 'Failed',
    className:
      'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30',
  },
};

export interface TransactionStatusBadgeProps {
  /** Transaction lifecycle state to display. */
  status: TransactionStatus;
  /** Overrides the default text (e.g. "Awaiting signature" instead of "Pending"). */
  label?: string;
  /** Extra classes merged onto the badge root, for layout composition. */
  className?: string;
  /**
   * Whether the pending state animates a spinner instead of a static clock.
   * Ignored for `success` and `failed`. Defaults to `true`.
   */
  showSpinner?: boolean;
}

/**
 * Transaction Status Badge
 *
 * A small, composable pill that reports the state of a Stellar transaction.
 * Shared by `<SendForm>` and `<TransactionList>` so status styling stays
 * consistent across the template.
 *
 * Status is communicated three ways — colour, icon, and text — so it never
 * depends on colour alone, and each palette has a dark-mode counterpart.
 *
 * @example
 * <TransactionStatusBadge status="pending" />
 * <TransactionStatusBadge status="success" label="Confirmed" />
 * <TransactionStatusBadge status="failed" className="ml-2" />
 */
export default function TransactionStatusBadge({
  status,
  label,
  className = '',
  showSpinner = true,
}: TransactionStatusBadgeProps) {
  const style = STATUS_STYLES[status];
  const text = label ?? style.label;

  const getIcon = () => {
    if (status === 'success') return <CheckIcon />;
    if (status === 'failed') return <XIcon />;
    return showSpinner ? <SpinnerIcon /> : <ClockIcon />;
  };

  return (
    <span
      // 'status' announces the pending → settled transition to screen readers
      // without stealing focus; the resolved states are not urgent enough for
      // an assertive live region.
      role="status"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${style.className} ${className}`.trim()}
    >
      {getIcon()}
      {text}
    </span>
  );
}
