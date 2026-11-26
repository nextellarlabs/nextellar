
/**
 * A single pulsing placeholder block. Reserves the exact space its final
 * content will occupy so loading states never cause layout shift once real
 * data arrives.
 *
 * Pass `label` when the block is the only loading indicator for its content,
 * so screen readers announce the loading state; omit it inside a larger
 * loading region such as `SkeletonList`, where the block stays decorative.
 *
 * @param {{ width?: string, height?: string, className?: string, label?: string }} props
 */
export function Skeleton({ width = 'w-full', height = 'h-4', className = '', label }) {
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
