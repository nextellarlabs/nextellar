'use client';

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from '../contexts/I18nProvider';

export interface TransactionOperationDetail {
  label: string;
  value: string;
}

export interface TransactionOperationSummary {
  type: string;
  summary: string;
  details?: TransactionOperationDetail[];
}

export interface TransactionConfirmModalProps {
  open: boolean;
  operations: TransactionOperationSummary[];
  fee: {
    amount: string;
    asset?: string;
  };
  onConfirm: () => void;
  onCancel: () => void;
  theme?: 'light' | 'dark';
}

export default function TransactionConfirmModal({
  open,
  operations,
  fee,
  onConfirm,
  onCancel,
  theme = 'light',
}: TransactionConfirmModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === 'Tab') {
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const surface =
    theme === 'light'
      ? 'border-gray-200 bg-white text-gray-900'
      : 'border-gray-700 bg-gray-900 text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-lg rounded-2xl border p-5 shadow-xl ${surface}`}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {t('transactionConfirm.title')}
        </h2>
        <p id={descriptionId} className="mt-1 text-sm opacity-75">
          {t('transactionConfirm.description')}
        </p>

        <section aria-label={t('transactionConfirm.operations')} className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">
            {t('transactionConfirm.operations')}
          </h3>
          <ol className="space-y-3">
            {operations.map((operation, index) => (
              <li
                key={`${operation.type}-${index}`}
                className="rounded-xl border border-gray-200 p-3 dark:border-gray-700"
              >
                <h4 className="text-sm font-medium">
                  {t('transactionConfirm.operationNumber', { number: index + 1 })}:{' '}
                  {operation.type}
                </h4>
                <p className="mt-1 text-sm opacity-80">{operation.summary}</p>
                {operation.details && operation.details.length > 0 && (
                  <dl className="mt-2 space-y-1 text-sm">
                    {operation.details.map((detail) => (
                      <div
                        key={`${detail.label}-${detail.value}`}
                        className="flex justify-between gap-4"
                      >
                        <dt className="opacity-70">{detail.label}</dt>
                        <dd className="text-right font-mono">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </section>

        <dl className="mt-4 flex justify-between gap-4 border-t border-gray-200 pt-3 text-sm dark:border-gray-700">
          <dt className="font-medium">{t('transactionConfirm.fee')}</dt>
          <dd className="font-mono font-semibold">
            {fee.amount}
            {fee.asset ? ` ${fee.asset}` : ''}
          </dd>
        </dl>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-current px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {t('transactionConfirm.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {t('transactionConfirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
