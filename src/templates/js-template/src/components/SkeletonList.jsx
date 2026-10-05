import { Skeleton } from './Skeleton';

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
 * A stack of skeleton rows for a data view that has not loaded yet.
 *
 * @param {{ rows?: number, label?: string, renderRow?: (index: number) => import('react').ReactNode }} props
 */
export function SkeletonList({ rows = 4, label = 'Loading', renderRow }) {
  return (
    <div className="w-full" role="status" aria-label={label}>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index}>{renderRow ? renderRow(index) : <DefaultSkeletonRow />}</div>
        ))}
      </div>
      <span className="sr-only">{label}...</span>
    </div>
  );
}