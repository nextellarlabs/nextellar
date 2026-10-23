import { Wallet, Inbox } from 'lucide-react';

/**
 * Generic empty-state block for list/balance views with nothing to show —
 * either because no wallet is connected yet, or because the connected
 * wallet simply has no data for that view.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.icon] Icon to display above the message. Defaults to an inbox icon.
 * @param {string} props.title Primary message, e.g. "No transactions yet".
 * @param {string} [props.description] Secondary, supporting copy shown beneath the title.
 * @param {import('react').ReactNode} [props.action] Optional action rendered beneath the description (e.g. a "Connect Wallet" button).
 *
 * @example
 * ```jsx
 * <EmptyState
 *   title={connected ? 'No transactions yet' : 'Connect wallet to view transactions'}
 *   description={connected ? 'Your transaction history will appear here' : undefined}
 * />
 * ```
 */
export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="w-full p-10 text-center" role="status">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
        {icon ?? <Inbox className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />}
      </div>
      <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">{title}</p>
      {description && (
        <p className="text-gray-600 dark:text-gray-300 text-xs mt-1 max-w-xs mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Preset icon for the "wallet not connected" flavor of empty state, kept
 * here alongside the component so consumers don't need to import
 * `lucide-react` directly just to match the built-in look.
 *
 * @example
 * ```jsx
 * <EmptyState icon={<NoWalletIcon />} title="Connect wallet to view balances" />
 * ```
 */
export function NoWalletIcon() {
  return <Wallet className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />;
}
