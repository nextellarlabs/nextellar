/**
 * A single pulsing placeholder block. Reserves the exact space its final
 * content will occupy so loading states never cause layout shift once real
 * data arrives — pass the same width/height the eventual content uses.
 *
 * @example
 * ```jsx
 * <Skeleton width="w-10" height="h-10" className="rounded-full" /> // avatar
 * <Skeleton width="w-28" /> // a line of text
 * ```
 *
 * @param {{ width?: string, height?: string, className?: string }} props
 */
export function Skeleton({ width = 'w-full', height = 'h-4', className = '' }) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${width} ${height} ${className}`}
      aria-hidden="true"
    />
  );
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
 * etc.) that hasn't loaded yet. Wraps the rows in a `role="status"` region
 * with a screen-reader-only label so loading is announced without visually
 * showing text.
 *
 * @example
 * ```jsx
 * <SkeletonList rows={4} label="Loading transaction history" />
 * ```
 *
 * @param {{ rows?: number, label?: string, renderRow?: (index: number) => import('react').ReactNode }} props
 */
export function SkeletonList({ rows = 4, label = 'Loading', renderRow }) {
  return (
    <div className="w-full" role="status" aria-label={label}>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i}>{renderRow ? renderRow(i) : <DefaultSkeletonRow />}</div>
        ))}
      </div>
      <span className="sr-only">{label}...</span>
    </div>
  );
}
