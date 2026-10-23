'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_START_LEDGER = 1;

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ContractEventHistoryOptions
 * @property {string} [sorobanRpc] - Soroban RPC endpoint URL. Falls back to the WalletProvider's configured URL, then a public testnet default.
 * @property {number} [startLedger] - Ledger number to start the history search from (inclusive).
 *   Ignored once a `cursor` has been established from a previous page. Defaults to `1`.
 * @property {string[][]} [topics] - Optional topic filters. Each inner array is one filter segment (up to 4).
 *   Topics are XDR-encoded ScVal strings, same shape as `useSorobanEvents`.
 * @property {number} [limit] - Maximum number of events returned per page. Defaults to 100.
 */

/**
 * @typedef {Object} FetchPageResult
 * @property {import('./useSorobanEvents').SorobanEvent[]} events - Events returned by this page, in RPC response order.
 * @property {string|undefined} cursor - Cursor to pass to the next `fetchPage` call to continue pagination, if any.
 * @property {boolean} isDone - True when the RPC response returned fewer events than `limit`, indicating no further pages.
 */

/**
 * @typedef {Object} UseContractEventHistoryReturn
 * @property {import('./useSorobanEvents').SorobanEvent[]} events - All events accumulated so far across every page fetched.
 * @property {boolean} loading
 * @property {Error|null} error
 * @property {boolean} isDone - True once a page has been fetched that returned fewer than `limit` events.
 * @property {() => Promise<FetchPageResult|undefined>} fetchNextPage - Fetch the next page of historical events and append it to `events`.
 *   Safe to call repeatedly (e.g. "Load more") — it resumes from the last cursor.
 *   No-ops while a fetch is already in flight, or once `isDone` is true.
 * @property {() => void} reset - Clears accumulated events and resets pagination back to the start.
 */

/**
 * Map the SDK's EventResponse to the same flat `SorobanEvent` shape used by
 * `useSorobanEvents`, so consumers of either hook interoperate.
 *
 * @param {import('@stellar/stellar-sdk').rpc.Api.EventResponse} raw
 * @returns {import('./useSorobanEvents').SorobanEvent}
 */
function mapEvent(raw) {
  return {
    id: raw.id,
    type: raw.type,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    contractId: raw.contractId?.toString() ?? '',
    topic: raw.topic.map((t) => t.toXDR('base64')),
    value: raw.value.toXDR('base64'),
    txHash: raw.txHash,
    inSuccessfulContractCall: raw.inSuccessfulContractCall,
  };
}

/**
 * Fetches historical Soroban contract events for a given ledger range, with
 * cursor-based pagination. Unlike `useSorobanEvents` (which polls for *live*
 * events), this hook performs on-demand, page-at-a-time lookups of past
 * events — e.g. for an activity feed, an audit log, or "load more" UI.
 *
 * @param {string} contractId - Soroban contract address to fetch event history for.
 * @param {ContractEventHistoryOptions} [opts] - Configuration options (starting ledger, topic filters, page size).
 * @returns {UseContractEventHistoryReturn}
 *
 * @example
 * ```jsx
 * function EventHistory({ contractId }) {
 *   const { events, loading, error, isDone, fetchNextPage } =
 *     useContractEventHistory(contractId, { startLedger: 100000 });
 *
 *   return (
 *     <div>
 *       {events.map((e) => (
 *         <div key={e.id}>{e.type} @ ledger {e.ledger}</div>
 *       ))}
 *       {error && <p>Error: {error.message}</p>}
 *       {!isDone && (
 *         <button onClick={fetchNextPage} disabled={loading}>
 *           {loading ? 'Loading…' : 'Load more'}
 *         </button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useContractEventHistory(contractId, opts = {}) {
  const providerConfig = useWalletConfig();
  const {
    sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC,
    startLedger = DEFAULT_START_LEDGER,
    topics,
    limit = DEFAULT_PAGE_LIMIT,
  } = opts;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDone, setIsDone] = useState(false);

  const cursorRef = useRef(undefined);
  const isFetchingRef = useRef(false);

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const fetchNextPage = useCallback(async () => {
    if (isFetchingRef.current || isDone) return undefined;

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const filter = {
        type: 'contract',
        contractIds: [contractId],
        ...(topics && topics.length > 0 ? { topics } : {}),
      };

      // GetEventsRequest is a discriminated union: cursor mode xor startLedger mode.
      const request = cursorRef.current
        ? { filters: [filter], cursor: cursorRef.current, limit }
        : { filters: [filter], startLedger, limit };

      const response = await rpcServer.getEvents(request);
      const pageEvents = response.events.map(mapEvent);
      const pageIsDone = response.events.length < limit;

      if (response.cursor) {
        cursorRef.current = response.cursor;
      }

      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...pageEvents.filter((e) => !seen.has(e.id))];
      });
      setIsDone(pageIsDone);

      return { events: pageEvents, cursor: cursorRef.current, isDone: pageIsDone };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [contractId, rpcServer, topics, limit, startLedger, isDone]);

  const reset = useCallback(() => {
    cursorRef.current = undefined;
    isFetchingRef.current = false;
    setEvents([]);
    setError(null);
    setIsDone(false);
    setLoading(false);
  }, []);

  return { events, loading, error, isDone, fetchNextPage, reset };
}
