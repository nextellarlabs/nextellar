'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildSep24InteractiveUrl,
  fetchSep24Transaction,
  isSep24InteractiveComplete,
  isSep24Terminal,
  parseSep24Message,
  startSep24Interactive,
  type Sep24Kind,
  type Sep24Transaction,
} from '../lib/sep24';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * - `idle`        nothing started
 * - `starting`    requesting the interactive URL from the anchor
 * - `interactive` the anchor's form is open (popup or iframe)
 * - `pending`     the user finished the form; the anchor/wallet still has work
 *                 to do (e.g. `pending_user_transfer_start` for a withdrawal)
 * - `completed`   terminal success (`completed` or `refunded`)
 * - `failed`      terminal failure (`error`, `expired`, `no_market`, …)
 * - `closed`      the user closed the window before finishing
 * - `error`       the request or popup failed (see `error`)
 */
export type Sep24FlowStatus =
  | 'idle'
  | 'starting'
  | 'interactive'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'closed'
  | 'error';

export interface Sep24StartOptions {
  transferServer: string;
  kind: Sep24Kind;
  authToken: string;
  assetCode: string;
  assetIssuer?: string;
  account?: string;
  amount?: string;
  lang?: string;
  extra?: Record<string, string>;
  /** `popup` opens a window (default); `iframe` only exposes `url` for <Sep24InteractiveFrame>. */
  mode?: 'popup' | 'iframe';
}

export interface UseSep24InteractiveOptions {
  fetchImpl?: typeof fetch;
  /** Poll GET /transaction every N ms while the flow is open. 0 disables polling. Default 5000. */
  pollIntervalMs?: number;
  /** Close the popup once the user finishes the form. Default true. */
  closePopupOnComplete?: boolean;
  /** Injected for tests; defaults to `window.open`. */
  openWindow?: (url: string, name: string, features: string) => Window | null;
  /** Called on every transaction update (message or poll). */
  onUpdate?: (transaction: Sep24Transaction) => void;
}

export interface UseSep24InteractiveReturn {
  start: (options: Sep24StartOptions) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  status: Sep24FlowStatus;
  /** Interactive URL (with callback=postMessage) — render it in an iframe in `iframe` mode, or as a fallback link if the popup was blocked. */
  url: string | null;
  transactionId: string | null;
  transaction: Sep24Transaction | null;
  error: Error | null;
}

const POPUP_FEATURES = 'popup=yes,width=500,height=800,noopener=no';

function statusFor(tx: Sep24Transaction): Sep24FlowStatus | null {
  if (isSep24Terminal(tx.status)) {
    return tx.status === 'completed' || tx.status === 'refunded' ? 'completed' : 'failed';
  }
  if (isSep24InteractiveComplete(tx.status)) return 'pending';
  return null;
}

/**
 * Drives the SEP-24 interactive deposit/withdraw flow: requests the anchor's
 * interactive URL, opens it, listens for the anchor's `postMessage` updates
 * (origin- and id-checked) and polls `GET /transaction` as a fallback, which
 * also covers anchors that redirect instead of posting messages.
 *
 * @example
 * const sep24 = useSep24Interactive();
 * await sep24.start({ transferServer, kind: 'deposit', authToken: jwt, assetCode: 'USDC', account });
 * if (sep24.status === 'pending' && sep24.transaction?.withdraw_anchor_account) { ...send payment... }
 */
export function useSep24Interactive(
  options: UseSep24InteractiveOptions = {},
): UseSep24InteractiveReturn {
  const {
    fetchImpl,
    pollIntervalMs = 5000,
    closePopupOnComplete = true,
    openWindow,
    onUpdate,
  } = options;

  const [status, setStatusState] = useState<Sep24FlowStatus>('idle');
  const statusRef = useRef<Sep24FlowStatus>('idle');
  const setStatus = useCallback((next: Sep24FlowStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const [url, setUrl] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Sep24Transaction | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const session = useRef<{
    id: string;
    origin: string;
    transferServer: string;
    authToken: string;
    popup: Window | null;
    timer: ReturnType<typeof setInterval> | null;
    done: boolean;
  } | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const stop = useCallback((closePopup: boolean) => {
    const s = session.current;
    if (!s) return;
    if (s.timer) clearInterval(s.timer);
    s.timer = null;
    if (closePopup && s.popup && !s.popup.closed) {
      try {
        s.popup.close();
      } catch {
        /* cross-origin close can throw in some browsers */
      }
    }
  }, []);

  const apply = useCallback(
    (tx: Sep24Transaction) => {
      const s = session.current;
      if (!s || s.done || tx.id !== s.id) return;
      setTransaction(tx);
      onUpdateRef.current?.(tx);
      const next = statusFor(tx);
      if (!next) return;
      setStatus(next);
      if (next === 'pending' && closePopupOnComplete && s.popup && !s.popup.closed) {
        try {
          s.popup.close();
        } catch {
          /* ignore */
        }
      }
      if (next === 'completed' || next === 'failed') {
        s.done = true;
        stop(closePopupOnComplete);
      }
    },
    [closePopupOnComplete, setStatus, stop],
  );

  const poll = useCallback(async () => {
    const s = session.current;
    if (!s || s.done) return;
    try {
      const tx = await fetchSep24Transaction({
        transferServer: s.transferServer,
        authToken: s.authToken,
        id: s.id,
        fetchImpl,
      });
      apply(tx);
    } catch {
      // Transient poll failures are ignored; the next tick retries.
    }
    const current = session.current;
    if (
      current &&
      !current.done &&
      current.popup?.closed &&
      statusRef.current === 'interactive'
    ) {
      // The user closed the popup before finishing the anchor's form.
      // (Once the form is finished — `pending` — polling continues so the
      // final status still arrives after the popup closes.)
      current.done = true;
      stop(false);
      setStatus('closed');
    }
  }, [apply, fetchImpl, setStatus, stop]);

  // postMessage listener, active while a session exists.
  useEffect(() => {
    if (!transactionId) return undefined;
    const handler = (event: MessageEvent) => {
      const s = session.current;
      if (!s) return;
      const tx = parseSep24Message(event, { origin: s.origin, transactionId: s.id });
      if (tx) apply(tx);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [transactionId, apply]);

  // Tear everything down on unmount.
  useEffect(() => () => stop(false), [stop]);

  const start = useCallback(
    async (opts: Sep24StartOptions) => {
      stop(true);
      session.current = null;
      setStatus('starting');
      setError(null);
      setTransaction(null);
      setUrl(null);
      setTransactionId(null);

      try {
        const res = await startSep24Interactive({ ...opts, fetchImpl });
        const interactiveUrl = buildSep24InteractiveUrl(res.url, { lang: opts.lang });

        let popup: Window | null = null;
        if ((opts.mode ?? 'popup') === 'popup') {
          const open = openWindow ?? ((u: string, n: string, f: string) => window.open(u, n, f));
          popup = open(interactiveUrl, 'sep24-interactive', POPUP_FEATURES);
        }

        session.current = {
          id: res.id,
          origin: new URL(interactiveUrl).origin,
          transferServer: opts.transferServer,
          authToken: opts.authToken,
          popup,
          timer: null,
          done: false,
        };
        setUrl(interactiveUrl);
        setTransactionId(res.id);

        if ((opts.mode ?? 'popup') === 'popup' && !popup) {
          setStatus('error');
          setError(new Error('The browser blocked the SEP-24 popup. Open the link manually or use iframe mode.'));
        } else {
          setStatus('interactive');
        }

        if (pollIntervalMs > 0) {
          session.current.timer = setInterval(() => {
            void poll();
          }, pollIntervalMs);
        }
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [fetchImpl, openWindow, pollIntervalMs, poll, setStatus, stop],
  );

  const cancel = useCallback(() => {
    stop(true);
    if (session.current) session.current.done = true;
    if (statusRef.current !== 'completed' && statusRef.current !== 'failed') setStatus('closed');
  }, [setStatus, stop]);

  const reset = useCallback(() => {
    stop(true);
    session.current = null;
    setStatus('idle');
    setUrl(null);
    setTransactionId(null);
    setTransaction(null);
    setError(null);
  }, [setStatus, stop]);

  return { start, cancel, reset, status, url, transactionId, transaction, error };
}
