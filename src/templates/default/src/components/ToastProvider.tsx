'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from '../contexts/I18nProvider';

export interface TransactionToast {
  status: 'success' | 'error';
  /** Optional explorer URL for the submitted transaction. */
  explorerUrl?: URL;
}

type Toast = TransactionToast & { id: number };
type Notify = (toast: TransactionToast) => void;

const DISMISS_AFTER_MS = 6000;
const ToastContext = createContext<Notify | null>(null);

function statusLabel(status: TransactionToast['status']) {
  return status === 'success' ? 'toast.success' : 'toast.error';
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const timeLeft = useRef(DISMISS_AFTER_MS);
  const paused = hovered || focused;
  const id = toast.id;

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(id), timeLeft.current);
    return () => {
      window.clearTimeout(timer);
      timeLeft.current = Math.max(0, timeLeft.current - (Date.now() - startedAt));
    };
  }, [id, onDismiss, paused]);

  const accent =
    toast.status === 'success'
      ? 'border-green-600 dark:border-green-400'
      : 'border-red-600 dark:border-red-400';

  return (
    <li
      className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border border-s-4 bg-white p-3 text-sm text-neutral-900 shadow-lg dark:bg-neutral-900 dark:text-neutral-100 ${accent}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="min-w-0">
        <p className="font-semibold">{t(statusLabel(toast.status))}</p>
        {toast.explorerUrl?.protocol === 'https:' && (
          <a
            className="mt-1 inline-flex min-h-6 items-center rounded underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            href={toast.explorerUrl.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('toast.viewInExplorer')}
          </a>
        )}
      </div>
      <button
        className="min-h-6 shrink-0 rounded px-1 text-neutral-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-neutral-300"
        type="button"
        onClick={() => onDismiss(id)}
      >
        {t('toast.dismiss')}
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const notify = useCallback<Notify>((toast) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div role="status" aria-atomic="false" className="sr-only">
        {toasts
          .filter((toast) => toast.status === 'success')
          .map((toast) => <span key={toast.id}>{t('toast.success')}</span>)}
      </div>
      <div role="alert" aria-atomic="false" className="sr-only">
        {toasts
          .filter((toast) => toast.status === 'error')
          .map((toast) => <span key={toast.id}>{t('toast.error')}</span>)}
      </div>
      {toasts.length > 0 && (
        <section
          aria-label={t('toast.notifications')}
          className="pointer-events-none fixed inset-x-4 bottom-4 z-50 sm:start-auto sm:w-96"
        >
          <ul className="space-y-2">
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </ul>
        </section>
      )}
    </ToastContext.Provider>
  );
}

/** Queues a result notification after a transaction completes or fails. */
export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used within a ToastProvider');
  return notify;
}
