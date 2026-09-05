'use client';

// ── Inline SVG icons ──────────────────────────────────────────────────────────

/**
 * @returns {JSX.Element}
 */
const SpinnerIcon = () => (
  <svg
    className="w-5 h-5 animate-spin"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

/**
 * @returns {JSX.Element}
 */
const AlertIcon = () => (
  <svg
    className="w-5 h-5 flex-shrink-0"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
    />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a stroops string to a human-readable XLM amount.
 * @param {string} stroops
 * @returns {string}
 */
function stroopsToXlm(stroops) {
  const n = Number(stroops);
  if (isNaN(n)) return stroops;
  return (n / 10_000_000).toFixed(7);
}

/**
 * Render an unknown simulation result value as a readable string.
 * @param {unknown} value
 * @returns {string}
 */
function formatResult(value) {
  if (value === null || value === undefined) return '(void)';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array)
    return Buffer.from(value).toString('hex');
  if (value instanceof Map) {
    const obj = {};
    value.forEach((v, k) => {
      obj[String(k)] = v;
    });
    return JSON.stringify(obj, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
  }
  return JSON.stringify(value, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * ContractCallPreview
 *
 * Displays a simulation/preview panel for a Soroban contract call before the
 * user confirms and submits the transaction. Shows:
 * - Estimated fee (in stroops and XLM)
 * - Decoded return value
 * - Latest ledger at time of simulation
 * - Loading skeleton while the RPC call is in-flight
 * - Error message if the simulation failed (e.g. contract revert)
 *
 * @param {{
 *   preview?: { result: unknown, minResourceFee: string, latestLedger: number },
 *   loading?: boolean,
 *   error?: Error | null,
 *   onConfirm?: () => void,
 *   onCancel?: () => void,
 *   className?: string,
 * }} props
 * @returns {JSX.Element | null}
 */
export default function ContractCallPreview({
  preview,
  loading = false,
  error = null,
  onConfirm,
  onCancel,
  className = '',
}) {
  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Simulating contract call…"
        className={`rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 ${className}`.trim()}
      >
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
          <SpinnerIcon />
          <span className="text-sm font-medium">Simulating transaction…</span>
        </div>
        {/* Skeleton rows */}
        <div className="mt-3 space-y-2">
          {[80, 60, 40].map((w) => (
            <div
              key={w}
              className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        role="alert"
        className={`rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/40 dark:bg-red-900/20 ${className}`.trim()}
      >
        <div className="flex items-start gap-3">
          <span className="text-red-500 dark:text-red-400">
            <AlertIcon />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              Simulation failed
            </p>
            <p className="mt-0.5 text-sm text-red-700 dark:text-red-400">
              {error.message}
            </p>
          </div>
        </div>
        {onCancel && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-300 hover:bg-red-100 dark:text-red-300 dark:ring-red-800 dark:hover:bg-red-900/40 transition-colors"
            >
              Go back
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Empty state (no preview yet) ──────────────────────────────────────────
  if (!preview) return null;

  const xlmFee = stroopsToXlm(preview.minResourceFee);

  // ── Preview data ──────────────────────────────────────────────────────────
  return (
    <section
      aria-label="Simulation preview"
      className={`rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/40 dark:bg-blue-900/20 ${className}`.trim()}
    >
      <h3 className="mb-3 text-sm font-semibold text-blue-900 dark:text-blue-200">
        Simulation Preview
      </h3>

      <dl className="space-y-2 text-sm">
        {/* Fee row */}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-gray-600 dark:text-gray-400">Estimated fee</dt>
          <dd className="font-mono font-medium text-gray-900 dark:text-gray-100">
            {preview.minResourceFee}{' '}
            <span className="font-normal text-gray-500 dark:text-gray-400">
              stroops
            </span>{' '}
            <span className="text-gray-400 dark:text-gray-500">
              ({xlmFee} XLM)
            </span>
          </dd>
        </div>

        {/* Return value row */}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-gray-600 dark:text-gray-400">Return value</dt>
          <dd
            className="max-w-[60%] truncate font-mono text-gray-900 dark:text-gray-100"
            title={formatResult(preview.result)}
          >
            {formatResult(preview.result)}
          </dd>
        </div>

        {/* Ledger row */}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-gray-600 dark:text-gray-400">Simulated at ledger</dt>
          <dd className="font-mono text-gray-900 dark:text-gray-100">
            #{preview.latestLedger.toLocaleString()}
          </dd>
        </div>
      </dl>

      {/* Action buttons */}
      {(onConfirm || onCancel) && (
        <div className="mt-4 flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          )}
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 transition-colors"
            >
              Confirm &amp; Submit
            </button>
          )}
        </div>
      )}
    </section>
  );
}
