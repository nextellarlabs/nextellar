'use client';

import {
  useState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import {
  I18nContext,
  I18nProvider,
  useTranslation,
} from '../contexts/I18nProvider';

export type StellarAddressPrefix = 'G' | 'M' | 'C';
export type StellarAddressKind = 'account' | 'muxed' | 'contract';
export type AddressValidationErrorCode =
  | 'required'
  | 'invalid_format'
  | 'invalid_account_checksum'
  | 'invalid_muxed_checksum'
  | 'invalid_contract_checksum'
  | 'disallowed_type';

export interface AddressValidationResult {
  isValid: boolean;
  isEmpty: boolean;
  normalized: string;
  prefix: StellarAddressPrefix | null;
  kind: StellarAddressKind | null;
  errorCode: AddressValidationErrorCode | null;
}

export interface ValidateStellarAddressOptions {
  required?: boolean;
  allowedTypes?: ReadonlyArray<StellarAddressPrefix>;
}

const DEFAULT_ALLOWED_TYPES: ReadonlyArray<StellarAddressPrefix> = [
  'G',
  'M',
  'C',
];

const BASE32_ADDRESS_CANDIDATE = /^[gmcGMC][a-zA-Z2-7]+$/;

/**
 * Trims surrounding whitespace and uppercases base32-shaped Stellar StrKey
 * candidates so pasted lowercase `g...` / `m...` / `c...` addresses validate
 * and emit cleanly in canonical uppercase form.
 */
export function normalizeStellarAddress(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  if (BASE32_ADDRESS_CANDIDATE.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

/**
 * Validates a Stellar `G...` (Ed25519 classic account), `M...` (Med25519 muxed
 * account), or `C...` (Soroban contract) address using `@stellar/stellar-sdk`
 * `StrKey` CRC16 checksum verification.
 */
export function validateStellarAddress(
  raw: string,
  options: ValidateStellarAddressOptions = {},
): AddressValidationResult {
  const { required = false, allowedTypes = DEFAULT_ALLOWED_TYPES } = options;
  const normalized = normalizeStellarAddress(raw);

  if (!normalized) {
    return {
      isValid: false,
      isEmpty: true,
      normalized: '',
      prefix: null,
      kind: null,
      errorCode: required ? 'required' : null,
    };
  }

  const firstChar = normalized[0];
  if (firstChar === 'G') {
    if (!StrKey.isValidEd25519PublicKey(normalized)) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'G',
        kind: null,
        errorCode: 'invalid_account_checksum',
      };
    }
    if (!allowedTypes.includes('G')) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'G',
        kind: 'account',
        errorCode: 'disallowed_type',
      };
    }
    return {
      isValid: true,
      isEmpty: false,
      normalized,
      prefix: 'G',
      kind: 'account',
      errorCode: null,
    };
  }

  if (firstChar === 'M') {
    if (!StrKey.isValidMed25519PublicKey(normalized)) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'M',
        kind: null,
        errorCode: 'invalid_muxed_checksum',
      };
    }
    if (!allowedTypes.includes('M')) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'M',
        kind: 'muxed',
        errorCode: 'disallowed_type',
      };
    }
    return {
      isValid: true,
      isEmpty: false,
      normalized,
      prefix: 'M',
      kind: 'muxed',
      errorCode: null,
    };
  }

  if (firstChar === 'C') {
    if (!StrKey.isValidContract(normalized)) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'C',
        kind: null,
        errorCode: 'invalid_contract_checksum',
      };
    }
    if (!allowedTypes.includes('C')) {
      return {
        isValid: false,
        isEmpty: false,
        normalized,
        prefix: 'C',
        kind: 'contract',
        errorCode: 'disallowed_type',
      };
    }
    return {
      isValid: true,
      isEmpty: false,
      normalized,
      prefix: 'C',
      kind: 'contract',
      errorCode: null,
    };
  }

  return {
    isValid: false,
    isEmpty: false,
    normalized,
    prefix: null,
    kind: null,
    errorCode: 'invalid_format',
  };
}

export interface AddressInputProps {
  /** Controlled input value. Omit to use uncontrolled state via `defaultValue`. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /**
   * Emits the normalized address string alongside the full StrKey validation
   * result whenever the address changes.
   */
  onChange?: (normalizedValue: string, validation: AddressValidationResult) => void;
  /** Emits validity changes for parent forms. */
  onValidityChange?: (
    isValid: boolean,
    validation: AddressValidationResult,
  ) => void;
  /** Permitted Stellar StrKey prefixes. Defaults to `['G', 'M', 'C']`. */
  allowedTypes?: ReadonlyArray<StellarAddressPrefix>;
  /** Marks the field required and surfaces an inline error on blur when empty. */
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  name?: string;
  /** Custom field label (defaults to localized `addressInput.label`). */
  label?: string;
  /** Custom input placeholder (defaults to localized `addressInput.placeholder`). */
  placeholder?: string;
  /** Optional helper description displayed below the input. */
  helperText?: string;
  showCopyButton?: boolean;
  showPasteButton?: boolean;
  showClearButton?: boolean;
  className?: string;
}

function AddressInputInner({
  value,
  defaultValue = '',
  onChange,
  onValidityChange,
  allowedTypes = DEFAULT_ALLOWED_TYPES,
  required = false,
  disabled = false,
  readOnly = false,
  id,
  name,
  label,
  placeholder,
  helperText,
  showCopyButton = true,
  showPasteButton = true,
  showClearButton = true,
  className = '',
}: AddressInputProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? `stellar-address-input-${generatedId}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(defaultValue);
  const [touched, setTouched] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [clipboardError, setClipboardError] = useState<
    'read' | 'write' | null
  >(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidityKeyRef = useRef<string>('');

  const rawValue = isControlled ? value : internalValue;
  const validation = validateStellarAddress(rawValue, {
    required,
    allowedTypes,
  });

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!onValidityChange) {
      return;
    }
    const key = `${validation.isValid}:${validation.normalized}:${validation.errorCode ?? ''}`;
    if (lastValidityKeyRef.current !== key) {
      lastValidityKeyRef.current = key;
      onValidityChange(validation.isValid, validation);
    }
  }, [onValidityChange, validation]);

  const commitValue = useCallback(
    (nextRaw: string, shouldNormalizeDisplay = false) => {
      setClipboardError(null);
      const nextValidation = validateStellarAddress(nextRaw, {
        required,
        allowedTypes,
      });
      const displayValue = shouldNormalizeDisplay
        ? nextValidation.normalized
        : nextRaw;
      if (!isControlled) {
        setInternalValue(displayValue);
      }
      onChange?.(nextValidation.normalized, nextValidation);
    },
    [allowedTypes, isControlled, onChange, required],
  );

  const resolveValidationErrorMessage = (): string | null => {
    if (clipboardError === 'read') {
      return t('addressInput.errors.clipboardReadFailed');
    }
    if (clipboardError === 'write') {
      return t('addressInput.errors.clipboardWriteFailed');
    }
    if (!validation.errorCode) {
      return null;
    }
    if (validation.errorCode === 'required' && !touched) {
      return null;
    }

    switch (validation.errorCode) {
      case 'required':
        return t('addressInput.errors.required');
      case 'invalid_account_checksum':
        return t('addressInput.errors.invalidAccountChecksum');
      case 'invalid_muxed_checksum':
        return t('addressInput.errors.invalidMuxedChecksum');
      case 'invalid_contract_checksum':
        return t('addressInput.errors.invalidContractChecksum');
      case 'disallowed_type':
        return t('addressInput.errors.disallowedType', {
          type: validation.prefix ?? '',
          allowed: allowedTypes.map((p) => `${p}...`).join(', '),
        });
      case 'invalid_format':
      default:
        return t('addressInput.errors.invalidFormat');
    }
  };

  const resolveValidKindMessage = (): string | null => {
    if (!validation.isValid || !validation.kind) {
      return null;
    }
    switch (validation.kind) {
      case 'account':
        return t('addressInput.validAccount');
      case 'muxed':
        return t('addressInput.validMuxed');
      case 'contract':
        return t('addressInput.validContract');
    }
  };

  const visibleError = resolveValidationErrorMessage();
  const validStatusMessage = visibleError ? null : resolveValidKindMessage();

  const describedByIds =
    [
      helperText ? helperId : null,
      visibleError ? errorId : null,
      validStatusMessage ? statusId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  const handleCopy = async () => {
    if (!validation.normalized) {
      return;
    }
    setClipboardError(null);
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard write unavailable');
      }
      await navigator.clipboard.writeText(validation.normalized);
      setCopied(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      setClipboardError('write');
    }
  };

  const handlePasteClick = async () => {
    if (disabled || readOnly) {
      return;
    }
    setTouched(true);
    setClipboardError(null);
    try {
      if (!navigator?.clipboard?.readText) {
        throw new Error('Clipboard read unavailable');
      }
      const clipText = await navigator.clipboard.readText();
      commitValue(clipText, true);
      inputRef.current?.focus();
    } catch {
      setClipboardError('read');
    }
  };

  const handleClear = () => {
    if (disabled || readOnly) {
      return;
    }
    setCopied(false);
    commitValue('', true);
    inputRef.current?.focus();
  };

  const resolvedLabel = label ?? t('addressInput.label');
  const resolvedPlaceholder = placeholder ?? t('addressInput.placeholder');

  return (
    <div className={`w-full space-y-1.5 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-800 dark:text-gray-200"
        >
          {resolvedLabel}
        </label>
        <div className="flex items-center gap-1.5">
          {showPasteButton && !readOnly && (
            <button
              type="button"
              onClick={handlePasteClick}
              disabled={disabled}
              aria-label={t('addressInput.paste')}
              className="rounded px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('addressInput.paste')}
            </button>
          )}
          {showCopyButton && (
            <button
              type="button"
              onClick={handleCopy}
              disabled={disabled || !validation.normalized}
              aria-label={
                copied ? t('addressInput.copied') : t('addressInput.copy')
              }
              className="rounded px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {copied ? t('addressInput.copied') : t('addressInput.copy')}
            </button>
          )}
          {showClearButton && !readOnly && Boolean(rawValue) && (
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              aria-label={t('addressInput.clear')}
              className="rounded px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('addressInput.clear')}
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={rawValue}
        placeholder={resolvedPlaceholder}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={describedByIds}
        onChange={(e) => {
          commitValue(e.target.value, false);
        }}
        onBlur={() => {
          setTouched(true);
          if (rawValue !== validation.normalized) {
            commitValue(validation.normalized, true);
          }
        }}
        className={`w-full rounded-md border px-3 py-2 font-mono text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
          visibleError
            ? 'border-red-500 bg-white text-gray-900 focus:border-red-500 focus:ring-red-500 dark:border-red-400 dark:bg-gray-900 dark:text-gray-100'
            : validation.isValid
              ? 'border-emerald-600 bg-white text-gray-900 focus:border-emerald-600 focus:ring-emerald-500 dark:border-emerald-500 dark:bg-gray-900 dark:text-gray-100'
              : 'border-gray-300 bg-white text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      />

      {helperText && (
        <p id={helperId} className="text-xs text-gray-600 dark:text-gray-400">
          {helperText}
        </p>
      )}

      {visibleError && (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-red-700 dark:text-red-400"
        >
          {visibleError}
        </p>
      )}

      {validStatusMessage && (
        <p
          id={statusId}
          aria-live="polite"
          className="text-xs font-medium text-emerald-800 dark:text-emerald-400"
        >
          {validStatusMessage}
        </p>
      )}

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? t('addressInput.copied') : ''}
      </span>
    </div>
  );
}

/**
 * Accessible Stellar address input supporting classic `G...` accounts, muxed
 * `M...` accounts, and Soroban `C...` contracts with StrKey checksum
 * validation, copy/paste/clear controls, and `I18nProvider` localization.
 */
export default function AddressInput(props: AddressInputProps) {
  const i18n = useContext(I18nContext);
  if (i18n === undefined) {
    return (
      <I18nProvider>
        <AddressInputInner {...props} />
      </I18nProvider>
    );
  }
  return <AddressInputInner {...props} />;
}
