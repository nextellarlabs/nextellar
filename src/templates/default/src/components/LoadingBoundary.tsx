import { Suspense, type ReactNode } from 'react';
import { SkeletonList, type SkeletonListProps } from './Skeleton';

export interface LoadingBoundaryProps {
  children: ReactNode;
  /** Screen-reader label for the fallback's loading region. */
  label?: string;
  /** Number of skeleton rows in the default fallback. Ignored if `fallback` is given. */
  rows?: SkeletonListProps['rows'];
  /** Custom fallback UI. Defaults to a `SkeletonList` sized to `rows`. */
  fallback?: ReactNode;
}

/**
 * Wraps an async data view (e.g. a Server Component reading from Horizon,
 * or a client component suspending on a data-fetching hook) in a
 * `<Suspense>` boundary with a layout-stable skeleton fallback, so the
 * page never jumps once real content resolves.
 *
 * @example
 * ```tsx
 * <LoadingBoundary label="Loading balances" rows={3}>
 *   <BalanceList />
 * </LoadingBoundary>
 * ```
 */
export default function LoadingBoundary({
  children,
  label = 'Loading',
  rows = 4,
  fallback,
}: LoadingBoundaryProps) {
  return (
    <Suspense fallback={fallback ?? <SkeletonList rows={rows} label={label} />}>
      {children}
    </Suspense>
  );
}
