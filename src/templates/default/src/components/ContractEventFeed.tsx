'use client';

import { useState, useMemo, useCallback, useContext } from 'react';
import { useSorobanEvents, type SorobanEvent } from '../hooks/useSorobanEvents';
import { useContractEventHistory } from '../hooks/useContractEventHistory';
import { decodeSorobanEvent, type SorobanValue } from '../lib/soroban-event-decoder';
import { I18nContext } from '../contexts/I18nProvider';
import { en } from '../locales/en';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_HEIGHT = 480;
const DEFAULT_ITEM_HEIGHT = 116;
const DEFAULT_OVERSCAN = 5;

// ── i18n helper (works with or without I18nProvider) ──────────────────────────

type FeedMessageKey = keyof typeof en.contractEventFeed;

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match
  );
}

function useFeedTranslation() {
  const ctx = useContext(I18nContext);
  return useCallback(
    (key: FeedMessageKey, params?: Record<string, string | number>): string => {
      if (ctx) {
        return ctx.t(`contractEventFeed.${key}`, params);
      }
      return interpolate(en.contractEventFeed[key], params);
    },
    [ctx]
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatSorobanValue(value: SorobanValue | unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    return JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint'
        ? v.toString()
        : v instanceof Uint8Array
          ? Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')
          : v
    );
  } catch {
    return String(value);
  }
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Inline SVG Icons ──────────────────────────────────────────────────────────

const SpinnerIcon = () => (
  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const AlertIcon = () => (
  <svg
    className="h-5 w-5 flex-shrink-0"
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

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DecodedContractEvent {
  raw: SorobanEvent;
  decodedTopics: string[];
  decodedValue: string;
  decodeFailed: boolean;
}

export interface ContractEventFeedProps {
  /** Soroban contract address to stream and paginate events for. */
  contractId: string;
  /** Optional Soroban RPC endpoint URL. */
  sorobanRpc?: string;
  /** Starting ledger for historical pagination (`useContractEventHistory`). */
  startLedger?: number;
  /** Starting cursor for live polling (`useSorobanEvents`). */
  fromCursor?: string;
  /** Polling interval in milliseconds. Pass `null` to disable live polling. Defaults to 10 000 ms. */
  pollIntervalMs?: number | null;
  /** Optional RPC-level XDR topic filters passed to both hooks. */
  topics?: string[][];
  /** Maximum number of events per RPC page. Defaults to 100. */
  limit?: number;
  /** Height of the virtualized scroll viewport in pixels. Defaults to 480. */
  height?: number;
  /** Fixed row height in pixels used for virtualization math. Defaults to 116. */
  itemHeight?: number;
  /** Number of extra rows rendered above and below the viewport. Defaults to 5. */
  overscan?: number;
  /** Optional callback invoked when a user clicks an event row. */
  onEventSelect?: (event: DecodedContractEvent) => void;
  /** Extra CSS classes applied to the root section. */
  className?: string;
  /**
   * Optional controlled events override (useful for Storybook or static previews).
   * When provided, RPC polling is paused and these events are rendered directly.
   */
  events?: SorobanEvent[];
  /** Optional loading override for controlled previews. */
  loading?: boolean;
  /** Optional error override for controlled previews. */
  error?: Error | null;
  /** Optional recovering state override for controlled previews. */
  isRecovering?: boolean;
}

// ── Decoder wrapper ────────────────────────────────────────────────────────────

function decodeEventSafe(event: SorobanEvent): DecodedContractEvent {
  try {
    const valueStr = typeof event.value === 'string' ? event.value : String(event.value ?? '');
    const decoded = decodeSorobanEvent({ topic: event.topic, value: valueStr });
    return {
      raw: event,
      decodedTopics: decoded.topics.map((topic) => formatSorobanValue(topic)),
      decodedValue: formatSorobanValue(decoded.value),
      decodeFailed: false,
    };
  } catch {
    return {
      raw: event,
      decodedTopics: event.topic,
      decodedValue: formatSorobanValue(event.value),
      decodeFailed: true,
    };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * ContractEventFeed
 *
 * A live, virtualized feed of decoded Soroban contract events powered by
 * `useSorobanEvents` (real-time polling) and `useContractEventHistory`
 * (cursor-based historical pagination), with interactive topic filtering and
 * full i18n support through `I18nProvider`.
 */
export default function ContractEventFeed({
  contractId,
  sorobanRpc,
  startLedger,
  fromCursor,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  topics,
  limit = 100,
  height = DEFAULT_HEIGHT,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  onEventSelect,
  className = '',
  events: controlledEvents,
  loading: controlledLoading,
  error: controlledError,
  isRecovering: controlledRecovering,
}: ContractEventFeedProps) {
  const t = useFeedTranslation();
  const isControlled = controlledEvents !== undefined;

  const [isPaused, setIsPaused] = useState(pollIntervalMs === null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [topicQuery, setTopicQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  const live = useSorobanEvents(contractId, {
    sorobanRpc,
    fromCursor,
    pollIntervalMs: isControlled || isPaused ? null : pollIntervalMs,
    topics,
    limit,
  });

  const history = useContractEventHistory(contractId, {
    sorobanRpc,
    startLedger,
    topics,
    limit,
  });

  const loading = controlledLoading ?? (live.loading || history.loading);
  const error = controlledError !== undefined ? controlledError : (live.error ?? history.error);
  const isRecovering = controlledRecovering ?? live.isRecovering;

  // Merge live + historical events, deduplicated by id, newest ledger first
  const mergedEvents = useMemo<SorobanEvent[]>(() => {
    if (controlledEvents) return controlledEvents;
    const byId = new Map<string, SorobanEvent>();
    for (const evt of history.events) byId.set(evt.id, evt);
    for (const evt of live.events) byId.set(evt.id, evt);
    return Array.from(byId.values()).sort((a, b) => {
      if (b.ledger !== a.ledger) return b.ledger - a.ledger;
      return b.id.localeCompare(a.id);
    });
  }, [controlledEvents, history.events, live.events]);

  // Decode all events once per change
  const decodedEvents = useMemo<DecodedContractEvent[]>(
    () => mergedEvents.map(decodeEventSafe),
    [mergedEvents]
  );

  // Unique primary topics for quick-filter pills
  const availableTopics = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const evt of decodedEvents) {
      if (evt.decodedTopics.length > 0 && evt.decodedTopics[0]) {
        set.add(evt.decodedTopics[0]);
      }
    }
    return Array.from(set);
  }, [decodedEvents]);

  // Apply topic pill + search query filters
  const filteredEvents = useMemo<DecodedContractEvent[]>(() => {
    const q = topicQuery.trim().toLowerCase();
    return decodedEvents.filter((evt) => {
      if (selectedTopic && evt.decodedTopics[0] !== selectedTopic) {
        return false;
      }
      if (q) {
        const matchesTopic = evt.decodedTopics.some((topic) => topic.toLowerCase().includes(q));
        if (!matchesTopic) return false;
      }
      return true;
    });
  }, [decodedEvents, selectedTopic, topicQuery]);

  // Virtualization window calculation
  const totalHeight = filteredEvents.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    filteredEvents.length,
    Math.ceil((scrollTop + height) / itemHeight) + overscan
  );
  const visibleEvents = filteredEvents.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const hasActiveFilter = selectedTopic !== null || topicQuery.trim().length > 0;

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      if (next) {
        live.stopPolling();
      } else {
        void live.refresh();
      }
      return next;
    });
  }, [live]);

  const handleRefresh = useCallback(() => {
    void live.refresh();
  }, [live]);

  const handleLoadMore = useCallback(() => {
    void history.fetchNextPage().catch(() => {
      // Error state is already captured inside useContractEventHistory
    });
  }, [history]);

  const handleClearFilter = useCallback(() => {
    setSelectedTopic(null);
    setTopicQuery('');
    setScrollTop(0);
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const countLabel = hasActiveFilter
    ? t('filteredCount', { shown: filteredEvents.length, total: decodedEvents.length })
    : t('eventCount', { count: decodedEvents.length });

  return (
    <section
      aria-label={t('regionLabel')}
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${className}`.trim()}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('title')}
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPaused
                ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isPaused ? 'bg-gray-400' : 'animate-pulse bg-emerald-500'
              }`}
              aria-hidden="true"
            />
            {isPaused ? t('pausedBadge') : t('liveBadge')}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{countLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePause}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-800"
          >
            {isPaused ? t('resume') : t('pause')}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={live.loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {live.loading && <SpinnerIcon />}
            {t('refresh')}
          </button>
        </div>
      </div>

      {/* Recovering banner */}
      {isRecovering && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300"
        >
          {t('recoveringBanner')}
        </div>
      )}

      {/* Topic filter bar */}
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={topicQuery}
            onChange={(e) => {
              setTopicQuery(e.target.value);
              setScrollTop(0);
            }}
            aria-label={t('filterLabel')}
            placeholder={t('filterPlaceholder')}
            className="min-w-[180px] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 ring-1 ring-gray-300 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-800"
            >
              {t('clearFilter')}
            </button>
          )}
        </div>

        {availableTopics.length > 0 && (
          <div
            role="group"
            aria-label={t('topicGroupLabel')}
            className="flex flex-wrap items-center gap-1.5"
          >
            <button
              type="button"
              aria-pressed={selectedTopic === null}
              onClick={() => {
                setSelectedTopic(null);
                setScrollTop(0);
              }}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedTopic === null
                  ? 'bg-blue-600 text-white dark:bg-blue-500'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {t('allTopics')}
            </button>
            {availableTopics.map((topic) => {
              const active = selectedTopic === topic;
              return (
                <button
                  key={topic}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedTopic(active ? null : topic);
                    setScrollTop(0);
                  }}
                  className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {topic}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-900/20"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="text-red-500 dark:text-red-400">
                <AlertIcon />
              </span>
              <div>
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                  {t('errorTitle')}
                </p>
                <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">{error.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-red-300 transition-colors hover:bg-red-100 dark:text-red-300 dark:ring-red-800 dark:hover:bg-red-900/40"
            >
              {t('retry')}
            </button>
          </div>
        </div>
      )}

      {/* Initial loading state */}
      {loading && decodedEvents.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          aria-label={t('loadingLabel')}
          className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50"
        >
          <div className="flex items-center gap-2.5 text-gray-500 dark:text-gray-400">
            <SpinnerIcon />
            <span className="text-sm font-medium">{t('loadingText')}</span>
          </div>
          <div className="mt-3 space-y-2">
            {[85, 70, 55].map((w) => (
              <div
                key={w}
                className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state (no events at all) */}
      {!loading && !error && decodedEvents.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('emptyTitle')}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('emptyDescription')}
          </p>
        </div>
      )}

      {/* Empty state (filtered) */}
      {decodedEvents.length > 0 && filteredEvents.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('filteredEmptyTitle')}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('filteredEmptyDescription')}
          </p>
        </div>
      )}

      {/* Virtualized event feed */}
      {filteredEvents.length > 0 && (
        <div
          role="feed"
          aria-label={t('feedListLabel')}
          aria-busy={loading}
          onScroll={handleScroll}
          style={{ height }}
          className="mt-4 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-950/40"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visibleEvents.map((item, idx) => {
                const absoluteIndex = startIndex + idx;
                const { raw, decodedTopics, decodedValue, decodeFailed } = item;
                const isInteractive = Boolean(onEventSelect);

                return (
                  <article
                    key={raw.id}
                    aria-posinset={absoluteIndex + 1}
                    aria-setsize={filteredEvents.length}
                    tabIndex={isInteractive ? 0 : undefined}
                    onClick={isInteractive ? () => onEventSelect?.(item) : undefined}
                    onKeyDown={
                      isInteractive
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onEventSelect?.(item);
                            }
                          }
                        : undefined
                    }
                    style={{ height: itemHeight }}
                    className={`box-border flex flex-col justify-between border-b border-gray-200 bg-white px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-900 ${
                      isInteractive
                        ? 'cursor-pointer transition-colors hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 dark:hover:bg-blue-950/30'
                        : ''
                    }`.trim()}
                  >
                    {/* Top row: topics + status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {decodedTopics.length > 0 ? (
                          decodedTopics.map((topic, tIdx) => (
                            <span
                              key={`${raw.id}-t-${tIdx}`}
                              className="max-w-[180px] truncate rounded bg-blue-100 px-2 py-0.5 font-mono text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                              title={topic}
                            >
                              {topic}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs italic text-gray-400 dark:text-gray-500">
                            {t('noTopics')}
                          </span>
                        )}
                      </div>

                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          raw.inSuccessfulContractCall
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {raw.inSuccessfulContractCall ? t('statusSuccess') : t('statusFailed')}
                      </span>
                    </div>

                    {/* Middle row: decoded value */}
                    <div className="flex items-center gap-2">
                      {decodeFailed && (
                        <span className="flex-shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('rawValueLabel')}
                        </span>
                      )}
                      <p
                        className="truncate font-mono text-xs text-gray-800 dark:text-gray-200"
                        title={decodedValue}
                      >
                        {decodedValue}
                      </p>
                    </div>

                    {/* Bottom row: ledger, tx hash, timestamp */}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-3 font-mono">
                        <span>{t('ledgerLabel', { ledger: raw.ledger.toLocaleString() })}</span>
                        <span title={raw.txHash}>
                          {t('txLabel', { hash: truncateHash(raw.txHash) })}
                        </span>
                      </div>
                      <time dateTime={raw.ledgerClosedAt}>
                        {formatTimestamp(raw.ledgerClosedAt)}
                      </time>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Historical pagination footer */}
      {!isControlled && (
        <div className="mt-3 flex items-center justify-center">
          {history.isDone ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('allLoaded')}</p>
          ) : (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={history.loading}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:ring-gray-600 dark:hover:bg-gray-800"
            >
              {history.loading && <SpinnerIcon />}
              {history.loading ? t('loadingMore') : t('loadMore')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
