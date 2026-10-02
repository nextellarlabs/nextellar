import { Inbox, Wallet } from 'lucide-react';

/**
 * Generic empty-state block for list/balance views with nothing to show —
 * either because no wallet is connected yet, or because the connected
 * wallet simply has no data for that view.
 *
 * @example
 * ```jsx
 * <EmptyState
 *   title={connected ? 'No transactions yet' : 'Connect wallet to view transactions'}
 *   description={connected ? 'Your transaction history will appear here' : undefined}
 * />
 * ```
 *
 * @param {{ icon?: import('react').ReactNode, title: string, description?: string, action?: import('react').ReactNode }} props
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
 * Preset icon for the "wallet not connected" flavor of empty state.
 *
 * @example
 * ```jsx
 * <EmptyState icon={<NoWalletIcon />} title="Connect wallet to view balances" />
 * ```
 */
export function NoWalletIcon() {
  return <Wallet className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />;
}
