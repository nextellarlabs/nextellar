import { Suspense } from 'react';
import { SkeletonList } from './SkeletonList';

/**
 * Wraps an async data view in a Suspense boundary with a layout-stable
 * skeleton fallback.
 *
 * @param {{ children: import('react').ReactNode, label?: string, rows?: number, fallback?: import('react').ReactNode }} props
 */
export default function LoadingBoundary({
  children,
  label = 'Loading',
  rows = 4,
  fallback,
}) {
  return (
    <Suspense fallback={fallback ?? <SkeletonList rows={rows} label={label} />}>
      {children}
    </Suspense>
  );
}