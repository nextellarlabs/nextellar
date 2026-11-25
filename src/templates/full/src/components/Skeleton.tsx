import type { ReactNode } from 'react';

export interface SkeletonProps {
  /** Tailwind width class, e.g. "w-28". Defaults to full width. */
  width?: string;
  /** Tailwind height class, e.g. "h-4". Defaults to "h-4". */
  height?: string;
  /** Extra classes, e.g. "rounded-full" for an avatar placeholder. */
  className?: string;
  /**
   * Accessible loading announcement. Omit it (the default) when the block is
   * one piece of a larger loading region such as `SkeletonList`: the block
   * then stays decorative and hidden from assistive tech. Pass it when the
   * block is the only loading indicator for its content, so screen readers
   * announce the loading state instead of meeting a silent placeholder.
   */
  label?: string;
}

/**
 * A single pulsing placeholder block. Reserves the exact space its final
 * content will occupy so loading states never cause layout shift once real
 * data arrives — pass the same width/height the eventual content uses.
 *
 * @example
 * ```tsx
 * <Skeleton width="w-10" height="h-10" className="rounded-full" /> // avatar
 * <Skeleton width="w-28" /> // a line of text
 * <Skeleton width="w-28" label="Loading balance" /> // standalone, announced
 * ```
 */
export function Skeleton({ width = 'w-full', height = 'h-4', className = '', label }: SkeletonProps) {
  const classes = `animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${width} ${height} ${className}`;

  if (label) {
    return (
      <div className={classes} role="status" aria-live="polite" aria-busy="true" aria-label={label}>
        <span className="sr-only">{label}...</span>
      </div>
    );
  }

  return <div className={classes} aria-hidden="true" />;
}

export interface SkeletonListProps {
  /** Number of skeleton rows to render. Defaults to 4. */
  rows?: number;
  /** Accessible label announced to screen readers while loading. */
  label?: string;
  /** Render function for a single row's skeleton shape. Defaults to a generic row. */
  renderRow?: (index: number) => ReactNode;
}

function DefaultSkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4">
      <Skeleton width="w-10" height="h-10" className="rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton width="w-28" />
        <Skeleton width="w-20" height="h-3" />
      </div>
      <div className="flex-shrink-0 text-right space-y-2">
        <Skeleton width="w-20" className="ml-auto" />
        <Skeleton width="w-14" height="h-3" className="ml-auto" />
      </div>
    </div>
  );
}

/**
 * A stack of skeleton rows for a data view (transaction list, balance list,
 * etc.) that hasn't loaded yet. Wraps the rows in a polite `role="status"`
 * live region marked `aria-busy="true"`, with a screen-reader-only label, so
 * loading is announced without visually showing text. The placeholder rows
 * themselves are hidden from assistive tech.
 *
 * @example
 * ```tsx
 * <SkeletonList rows={4} label="Loading transaction history" />
 * ```
 */
export function SkeletonList({ rows = 4, label = 'Loading', renderRow }: SkeletonListProps) {
  return (
    <div className="w-full" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <div className="divide-y divide-gray-100 dark:divide-gray-800" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>{renderRow ? renderRow(i) : <DefaultSkeletonRow />}</div>
        ))}
      </div>
      <span className="sr-only">{label}...</span>
    </div>
  );
}
