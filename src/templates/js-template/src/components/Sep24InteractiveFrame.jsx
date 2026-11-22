"use client";

import { useEffect, useRef } from "react";

/**
 * Hosts a SEP-24 interactive deposit/withdrawal flow in a sandboxed iframe.
 *
 * SEP-24 ("Hosted Deposit and Withdrawal") has the anchor's
 * `POST /transactions/deposit/interactive` (or `/withdraw/interactive`)
 * endpoint return an `interactive_url` plus a transaction `id`; the wallet
 * is expected to render that URL so the user can complete KYC/payment
 * details on the anchor's own page, then watch for the anchor's
 * `window.postMessage` notifications to know when the flow finishes. This
 * component is the embedding + messaging half of that contract: it does
 * NOT call `/transactions/deposit/interactive` itself (that's a hook's
 * job, since it needs the asset code, amount, and the wallet's auth
 * token) — it just takes the resulting `url`/`transactionId` and manages
 * the iframe and its messages.
 *
 * Message handling: per SEP-24, the anchor's interactive page may post
 * `{ transaction: {...} }` whenever the transaction's status changes, and
 * conventionally posts a bare `"onMessage"`-less close signal. This
 * component forwards every `{ transaction }` message to `onMessage`, and
 * additionally calls `onComplete` once a terminal status is reached
 * (`completed`, `refunded`, or `error` — see the SEP-24 status enum), so a
 * consumer doesn't have to duplicate that status-matching logic. Messages
 * from other origins, or malformed messages without a `transaction`
 * field, are ignored rather than crashing the frame.
 *
 * @param {object} props
 * @param {string} props.url - The `interactive_url` returned by the
 *   anchor's interactive endpoint. Required; nothing is rendered without
 *   it.
 * @param {string} [props.transactionId] - The anchor's transaction id for
 *   this flow, shown in the frame's header so a user working through
 *   support can reference it.
 * @param {(data: { transaction?: Record<string, unknown> }) => void} [props.onMessage] -
 *   Called for every `postMessage` received from the iframe that carries a
 *   `transaction` field, with the raw message data.
 * @param {(transaction: Record<string, unknown>) => void} [props.onComplete] -
 *   Called once with the transaction object when its `status` reaches a
 *   terminal SEP-24 state (`completed`, `refunded`, `error`).
 * @param {() => void} [props.onClose] - Called when the user dismisses the
 *   frame via its close button, without waiting for a terminal status.
 * @param {string} [props.title] - Accessible title for the iframe.
 *   Defaults to "Anchor interactive flow".
 *
 * @example
 * ```jsx
 * <Sep24InteractiveFrame
 *   url={interactiveResponse.url}
 *   transactionId={interactiveResponse.id}
 *   onComplete={(tx) => console.log('done', tx)}
 *   onClose={() => setShowFrame(false)}
 * />
 * ```
 */
const TERMINAL_STATUSES = new Set(["completed", "refunded", "error"]);

export default function Sep24InteractiveFrame({
  url,
  transactionId,
  onMessage,
  onComplete,
  onClose,
  title = "Anchor interactive flow",
}) {
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
  }, [url]);

  useEffect(() => {
    if (!url) return;

    let frameOrigin;
    try {
      frameOrigin = new URL(url).origin;
    } catch {
      // An unparseable url means nothing will ever post a matching
      // message anyway; skip wiring the listener rather than throwing.
      return undefined;
    }

    function handleMessage(event) {
      // Only accept messages from the anchor's own origin: anything else
      // is not part of this SEP-24 flow and must not be trusted.
      if (event.origin !== frameOrigin) return;

      const data = event.data;
      if (!data || typeof data !== "object" || !data.transaction) return;

      if (onMessage) onMessage(data);

      const status = data.transaction.status;
      if (
        !completedRef.current &&
        typeof status === "string" &&
        TERMINAL_STATUSES.has(status)
      ) {
        completedRef.current = true;
        if (onComplete) onComplete(data.transaction);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [url, onMessage, onComplete]);

  if (!url) {
    return null;
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </p>
          {transactionId && (
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              Transaction {transactionId}
            </p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
      <iframe
        src={url}
        title={title}
        className="h-[600px] w-full border-0"
        // SEP-24 interactive pages need to run scripts and submit forms
        // (KYC forms, payment provider widgets) and frequently open a
        // payment confirmation popup; allow-same-origin is intentionally
        // withheld since this frame has no reason to trust the anchor's
        // page with this app's own origin privileges.
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
