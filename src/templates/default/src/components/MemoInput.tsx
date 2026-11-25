'use client';

import React, { useContext, useId } from 'react';
import { I18nContext } from '../contexts/I18nProvider';
import { MEMO_TYPES, validateMemo, type MemoType } from '../lib/memo';
import { en } from '../locales/en';

export interface MemoInputProps {
  id?: string;
  memoType: MemoType;
  memoValue: string;
  onMemoTypeChange: (type: MemoType) => void;
  onMemoValueChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  lockedReason?: string;
  error?: string | null;
  className?: string;
}

export const MemoInput: React.FC<MemoInputProps> = ({
  id,
  memoType,
  memoValue,
  onMemoTypeChange,
  onMemoValueChange,
  disabled = false,
  readOnly = false,
  lockedReason,
  error,
  className = '',
}) => {
  const generatedId = useId();
  const baseId = id || generatedId;
  const selectId = `${baseId}-memo-type`;
  const inputId = `${baseId}-memo-value`;
  const errorId = `${baseId}-memo-error`;
  const lockedId = `${baseId}-memo-locked`;

  const i18nContext = useContext(I18nContext);
  const t = i18nContext ? i18nContext.t : ((key: string) => {
    const keys = key.split('.');
    let curr: any = en;
    for (const k of keys) {
      if (!curr) return key;
      curr = curr[k];
    }
    return typeof curr === 'string' ? curr : key;
  });

  const validationError =
    memoType !== 'none' && memoType !== 'text' && memoValue.length === 0
      ? null
      : validateMemo(memoType, memoValue);
  const displayError = error !== undefined ? error : validationError;

  const placeholderByType: Record<MemoType, string> = {
    none: t('memo.placeholderNone'),
    text: t('memo.placeholderText'),
    id: t('memo.placeholderId'),
    hash: t('memo.placeholderHash'),
    return: t('memo.placeholderReturn'),
  };

  const labelByType: Record<MemoType, string> = {
    none: t('memo.none'),
    text: t('memo.text'),
    id: t('memo.id'),
    hash: t('memo.hash'),
    return: t('memo.return'),
  };

  const selectLabel = t('memo.type');
  const inputLabel = t('memo.label');
  const placeholder = placeholderByType[memoType];

  return (
    <div className={`space-y-2 ${className}`}>
      <div>
        <label
          htmlFor={selectId}
          className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
        >
          {selectLabel}
        </label>
        <select
          id={selectId}
          value={memoType}
          onChange={(e) => onMemoTypeChange(e.target.value as MemoType)}
          disabled={disabled || readOnly}
          aria-label={selectLabel}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          {MEMO_TYPES.map((type) => (
            <option key={type} value={type}>
              {labelByType[type]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={inputId}
          className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
        >
          {inputLabel}
        </label>
        <input
          id={inputId}
          type="text"
          value={memoType === 'none' ? '' : memoValue}
          onChange={(e) => onMemoValueChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={disabled || memoType === 'none'}
          aria-invalid={!!displayError}
          aria-describedby={`${errorId} ${lockedId}`}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 read-only:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:read-only:bg-gray-700"
        />
        <p
          id={lockedId}
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
        >
          {lockedReason ?? ''}
        </p>
        <p
          id={errorId}
          aria-live="assertive"
          aria-atomic="true"
          className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
        >
          {displayError ?? ''}
        </p>
      </div>
    </div>
  );
};

export default MemoInput;
