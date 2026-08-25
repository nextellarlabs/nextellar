'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts';
import { useTransactionHistory } from '../hooks/useTransactionHistory';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  AlertCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  Clock,
} from 'lucide-react';

// ── Operation type display ────────────────────────────────────────────────────

const OPERATION_TYPE_LABELS = {
  payment: 'Payment',
  create_account: 'Create Account',
  account_merge: 'Account Merge',
  account_deleted: 'Account Deleted',
  allow_trust: 'Allow Trust',
  bump_sequence: 'Bump Sequence',
  begin_sponsoring_future_reserves: 'Begin Sponsoring',
  change_trust: 'Change Trust',
  claim_claimable_balance: 'Claim Balance',
  clawback: 'Clawback',
  clawback_claimable_balance: 'Clawback Balance',
  create_claimable_balance: 'Create Claimable Balance',
  create_passive_sell_offer: 'Passive Sell Offer',
  end_sponsoring_future_reserves: 'End Sponsoring',
  extend_footprint_ttl: 'Extend TTL',
  inflation: 'Inflation',
  invoke_host_function: 'Contract Call',
  manage_buy_offer: 'Buy Offer',
  manage_data: 'Manage Data',
  manage_sell_offer: 'Sell Offer',
  path_payment_strict_receive: 'Path Payment',
  path_payment_strict_send: 'Path Payment',
  revoke_sponsorship: 'Revoke Sponsorship',
  set_options: 'Set Options',
  set_trust_line_flags: 'Set Trust Line Flags',
  liquidity_pool_deposit: 'LP Deposit',
  liquidity_pool_withdraw: 'LP Withdraw',
  restore_footprint: 'Restore Footprint',
  smart_account: 'Smart Account',
  sponsor: 'Sponsor',
  sponsor_future_reserves: 'Sponsor Reserves',
  bump_footprint_expiration: 'Bump Expiration',
};

function formatOperationType(type) {
  return (
    OPERATION_TYPE_LABELS[type] ||
    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── Address formatting ────────────────────────────────────────────────────────

function truncateAddress(address, length = 4) {
  if (!address) return 'Unknown';
  if (address.length <= length * 2 + 3) return address;
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(isoString) {
  if (!isoString) return '';

  const now = Date.now();
  const then = new Date(isoString).getTime();

  if (Number.isNaN(then)) return '';
  if (now - then < 0) return 'just now';

  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ── Amount & asset formatting ─────────────────────────────────────────────────

function formatAmount(amount) {
  if (!amount) return '';
  const num = parseFloat(amount);
  if (Number.isNaN(num)) return amount;
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

function getAssetLabel(item) {
  if (item.asset_type === 'native') return 'XLM';
  if (typeof item.asset_code === 'string') return item.asset_code;
  return 'XLM';
}

// ── Counterparty extraction ───────────────────────────────────────────────────

function getCounterparty(item, walletAddress) {
  // Payment operations have explicit from/to
  if (typeof item.from === 'string' && typeof item.to === 'string') {
    return {
      address: item.to === walletAddress ? item.from : item.to,
      isReceived: item.to === walletAddress,
    };
  }

  // For non-payment ops, the source_account is the sender
  const sourceAccount = item.source_account;
  return {
    address: sourceAccount,
    isReceived: sourceAccount !== walletAddress,
  };
}

// ── Status indicator ──────────────────────────────────────────────────────────

function getStatus(item) {
  if (typeof item.transaction_successful === 'boolean') {
    return {
      label: item.transaction_successful ? 'Success' : 'Failed',
      successful: item.transaction_successful,
    };
  }
  // If the field isn't present on older Horizon responses, assume success
  return { label: 'Success', successful: true };
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 p-4 animate-pulse"
      role="status"
      aria-label="Loading transaction"
    >
      <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
      <div className="flex-shrink-0 text-right space-y-2">
        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
        <div className="h-3 w-14 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
      </div>
    </div>
  );
}

// ── TransactionRow ────────────────────────────────────────────────────────────

function TransactionRow({ item, walletAddress }) {
  const { address: counterparty, isReceived } = getCounterparty(item, walletAddress);
  const status = getStatus(item);
  const hasAmount = typeof item.amount === 'string' && item.amount !== '';

  return (
    <div className="flex items-center gap-4 p-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      {/* Direction indicator */}
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isReceived
            ? 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400'
            : 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
        }`}
        aria-label={isReceived ? 'Received' : 'Sent'}
      >
        {isReceived ? (
          <ArrowDownLeft className="w-5 h-5" aria-hidden="true" />
        ) : (
          <ArrowUpRight className="w-5 h-5" aria-hidden="true" />
        )}
      </div>

      {/* Type and counterparty */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
            {formatOperationType(item.type)}
          </p>
          {!status.successful && (
            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
              Failed
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono truncate">
          {truncateAddress(counterparty)}
        </p>
      </div>

      {/* Amount and time */}
      <div className="flex-shrink-0 text-right">
        {hasAmount ? (
          <p
            className={`font-medium text-sm tabular-nums ${
              isReceived
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {isReceived ? '+' : '-'}
            {formatAmount(item.amount)}{' '}
            <span className="font-normal text-gray-500 dark:text-gray-400">
              {getAssetLabel(item)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {formatOperationType(item.type)}
          </p>
        )}
        <div className="flex items-center gap-1 justify-end mt-0.5">
          <Clock className="w-3 h-3 text-gray-400 dark:text-gray-500" aria-hidden="true" />
          <time
            dateTime={item.created_at}
            className="text-xs text-gray-400 dark:text-gray-500 tabular-nums"
          >
            {relativeTime(item.created_at)}
          </time>
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * TransactionList component
 *
 * Displays a paginated list of Stellar account operations / payments.
 *
 * @param {object}  props
 * @param {number}  [props.limit=10]                    - Transactions per page.
 * @param {'payments'|'operations'} [props.type]        - Fetch mode.
 */
export default function TransactionList({ limit = 10, type }) {
  const [mounted, setMounted] = useState(false);
  const { connected, publicKey } = useWallet();

  const { items, loading, error, fetchNextPage, refresh, hasMore } =
    useTransactionHistory(publicKey, {
      pageSize: limit,
      type,
    });

  // Prevent hydration mismatch in Next.js
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchNextPage();
    }
  }, [loading, hasMore, fetchNextPage]);

  // Guard: not mounted (SSR safety)
  if (!mounted) return null;

  // ── Initial loading state ────────────────────────────────────
  if (loading && items.length === 0) {
    return (
      <div className="w-full" role="status" aria-label="Loading transaction history">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
        <span className="sr-only">Loading transaction history...</span>
      </div>
    );
  }

  // ── Error state (no items loaded yet) ─────────────────────────
  if (error && items.length === 0) {
    return (
      <div className="w-full p-10 text-center" role="alert">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 mb-4">
          <AlertCircle className="w-6 h-6 text-red-500" aria-hidden="true" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">
          Failed to load transactions
        </p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1 max-w-xs mx-auto">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={handleRetry}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────
  if (!loading && items.length === 0) {
    return (
      <div className="w-full p-10 text-center" role="status">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <Receipt className="w-6 h-6 text-gray-400 dark:text-gray-500" aria-hidden="true" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">
          {connected ? 'No transactions yet' : 'Connect wallet to view transactions'}
        </p>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          {connected
            ? 'Your transaction history will appear here'
            : 'Your transactions will appear once your wallet is connected'}
        </p>
      </div>
    );
  }

  // ── Transaction list ──────────────────────────────────────────
  return (
    <div className="w-full">
      {/* Error banner (items loaded but fetchNextPage failed) */}
      {error && items.length > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-900/20"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-red-600 dark:text-red-400 flex-1">
            {error.message || 'Failed to load more transactions.'}
          </p>
          <button
            onClick={handleRetry}
            className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Transaction rows */}
      <div
        className="divide-y divide-gray-100 dark:divide-gray-800"
        role="list"
        aria-label="Transaction history"
      >
        {items.map((item) => (
          <div key={item.id} role="listitem">
            <TransactionRow item={item} walletAddress={publicKey || ''} />
          </div>
        ))}
      </div>

      {/* Pagination */}
      {hasMore && (
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium rounded-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98]"
            aria-label={loading ? 'Loading more transactions' : 'Load more transactions'}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Loading...
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                Load More
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
