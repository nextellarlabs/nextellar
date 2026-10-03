/**
 * A single pulsing placeholder block. Reserves the exact space its final
 * content will occupy so loading states never cause layout shift once real
 * data arrives.
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