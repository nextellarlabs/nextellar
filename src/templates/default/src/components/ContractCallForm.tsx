'use client';

import { useState, useCallback, useEffect } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import {
  useSorobanContract,
  type SimulateContractCallResult,
  type TypedArg,
} from '../hooks/useSorobanContract';
import {
  fetchContractSpec,
  type ContractFunctionArg,
  type ContractFunctionSpec,
} from '../lib/contract-spec';
import ContractCallPreview, { type SimulationPreview } from './ContractCallPreview';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContractCallFormProps {
  /**
   * Soroban contract ID (StrKey-encoded, starting with "C", 56 characters).
   * Passed directly to `useSorobanContract`.
   */
  contractId: string;
  /**
   * Soroban RPC endpoint URL.
   * Defaults to the Stellar testnet if omitted.
   */
  sorobanRpc?: string;
  /**
   * Network to target. Defaults to `"TESTNET"`.
   */
  network?: 'TESTNET' | 'PUBLIC';
  /**
   * When `true`, the form fetches the contract's on-chain spec/ABI on mount
   * (via {@link fetchContractSpec}) and renders a function **dropdown**
   * populated from it instead of the free-text function-name input. Falls
   * back to the free-text input if the spec fetch fails (e.g. the contract
   * has no embedded spec section) or while it's still loading.
   *
   * Defaults to `false` — the free-text input remains the default so this
   * is an opt-in enhancement, not a behavior change.
   */
  useContractSpec?: boolean;
  /**
   * Called after a successful `buildInvokeXDR`. Receives the unsigned XDR
   * string so the parent can hand it to a wallet adapter for signing and
   * submission. If omitted, the form logs the XDR to the console.
   */
  onSubmit?: (xdr: string) => void | Promise<void>;
  /** Extra CSS classes applied to the form root. */
  className?: string;
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Soroban function names are symbols: letters, digits and `_`, 1–32 chars. */
const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9_]{1,32}$/;
const ADDRESS_PATTERN = /^[GC][A-Z2-7]{55}$/;
const MUXED_ADDRESS_PATTERN = /^M[A-Z2-7]{68}$/;

/** Inclusive integer bounds for the Soroban integer types. */
const INTEGER_BOUNDS: Record<string, { min: bigint; max: bigint }> = {
  u32: { min: BigInt(0), max: BigInt(2) ** BigInt(32) - BigInt(1) },
  i32: { min: -(BigInt(2) ** BigInt(31)), max: BigInt(2) ** BigInt(31) - BigInt(1) },
  u64: { min: BigInt(0), max: BigInt(2) ** BigInt(64) - BigInt(1) },
  i64: { min: -(BigInt(2) ** BigInt(63)), max: BigInt(2) ** BigInt(63) - BigInt(1) },
  Timepoint: { min: BigInt(0), max: BigInt(2) ** BigInt(64) - BigInt(1) },
  Duration: { min: BigInt(0), max: BigInt(2) ** BigInt(64) - BigInt(1) },
  u128: { min: BigInt(0), max: BigInt(2) ** BigInt(128) - BigInt(1) },
  i128: { min: -(BigInt(2) ** BigInt(127)), max: BigInt(2) ** BigInt(127) - BigInt(1) },
  u256: { min: BigInt(0), max: BigInt(2) ** BigInt(256) - BigInt(1) },
  i256: { min: -(BigInt(2) ** BigInt(255)), max: BigInt(2) ** BigInt(255) - BigInt(1) },
};

/** Returns an error message for an invalid function name, or `null`. */
export function validateFunctionName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a function name.';
  if (!FUNCTION_NAME_PATTERN.test(trimmed)) {
    return 'Function names may only contain letters, numbers and underscores (max 32 characters).';
  }
  return null;
}

/**
 * Validates one argument value against its declared spec type. Returns an
 * error message, or `null` when the value is acceptable. Types the form
 * cannot check client-side (Bytes, Vec, user-defined types, …) are only
 * required to be non-empty; the simulation reports anything else.
 */
export function validateArgValue(value: string, type: string): string | null {
  const t = value.trim();
  if (!t) return 'This argument is required.';

  if (type === 'bool') {
    return t === 'true' || t === 'false' ? null : 'Enter true or false.';
  }

  const bounds = INTEGER_BOUNDS[type];
  if (bounds) {
    const unsigned = bounds.min === BigInt(0);
    if (!(unsigned ? /^\d+$/ : /^-?\d+$/).test(t)) {
      return unsigned ? `Enter a whole number (${type}).` : `Enter a whole number, optionally negative (${type}).`;
    }
    const n = BigInt(t);
    if (n < bounds.min || n > bounds.max) {
      return `Value is out of range for ${type}.`;
    }
    return null;
  }

  if (type === 'Address') {
    return ADDRESS_PATTERN.test(t) ? null : 'Enter a Stellar address (G… account or C… contract, 56 characters).';
  }
  if (type === 'MuxedAddress') {
    return ADDRESS_PATTERN.test(t) || MUXED_ADDRESS_PATTERN.test(t)
      ? null
      : 'Enter a Stellar address (G…, C… or M…).';
  }
  if (type === 'Symbol') {
    return SYMBOL_PATTERN.test(t) ? null : 'Symbols may only contain letters, numbers and underscores (max 32 characters).';
  }
  return null;
}

/** Converts a validated value to the TypedArg its spec type expects. */
function coerceTypedArg(value: string, type: string): TypedArg {
  const t = value.trim();
  if (type === 'bool') return t === 'true';
  if (INTEGER_BOUNDS[type]) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : BigInt(t);
  }
  return t;
}

const argFieldId = (index: number) => `ccf-arg-${index}`;
const errorIdFor = (fieldId: string) => `${fieldId}-error`;

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * ContractCallForm
 *
 * A ready-to-use form that lets a user:
 * 1. Enter a contract function name and comma-separated arguments.
 * 2. Click **Preview** to run `simulateContractCall` and see the estimated
 *    fee and return value — without spending any real fees.
 * 3. Click **Confirm & Submit** to build the unsigned XDR and hand it off to
 *    a wallet adapter (via the `onSubmit` callback).
 *
 * The preview panel (`ContractCallPreview`) is shown between step 2 and 3,
 * satisfying the acceptance criterion: "preview displays simulated result/fees
 * before submit."
 *
 * @example
 * ```tsx
 * <ContractCallForm
 *   contractId={process.env.NEXT_PUBLIC_CONTRACT_ID!}
 *   onSubmit={async (xdr) => {
 *     const signed = await wallet.signTransaction(xdr);
 *     await submitToNetwork(signed);
 *   }}
 * />
 * ```
 */
export default function ContractCallForm({
  contractId,
  sorobanRpc,
  network = 'TESTNET',
  useContractSpec = false,
  onSubmit,
  className = '',
}: ContractCallFormProps) {
  const [fnName, setFnName] = useState('');
  const [rawArgs, setRawArgs] = useState('');
  const [preview, setPreview] = useState<SimulationPreview | undefined>();
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [specFunctions, setSpecFunctions] = useState<ContractFunctionSpec[] | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  /** Values of the per-argument fields shown for a spec-selected function. */
  const [argValues, setArgValues] = useState<string[]>([]);
  /** Validation errors keyed by field id (`ccf-fn-name`, `ccf-args`, `ccf-arg-N`). */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedSpec = specFunctions?.find((fn) => fn.name === fnName) ?? null;
  const specArgs: ContractFunctionArg[] | null = selectedSpec ? selectedSpec.args : null;

  const clearFieldError = useCallback((fieldId: string) => {
    setFieldErrors((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  const opts = {
    contractId,
    ...(sorobanRpc ? { sorobanRpc } : {}),
    network,
  };

  const { simulateContractCall, buildInvokeXDR, loading, error } =
    useSorobanContract(opts);

  // ── Optional spec-driven function dropdown ──────────────────────────────
  useEffect(() => {
    if (!useContractSpec) {
      setSpecFunctions(null);
      return;
    }

    let cancelled = false;
    setSpecLoading(true);

    const rpcUrl = sorobanRpc ?? 'https://soroban-testnet.stellar.org';
    const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

    fetchContractSpec(rpcUrl, contractId, networkPassphrase)
      .then(({ functions }) => {
        if (!cancelled) setSpecFunctions(functions);
      })
      .catch(() => {
        // Spec fetch is a best-effort enhancement — fall back to the
        // free-text input rather than surfacing this as a form error.
        if (!cancelled) setSpecFunctions(null);
      })
      .finally(() => {
        if (!cancelled) setSpecLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [useContractSpec, contractId, sorobanRpc, network]);

  /**
   * Parse the raw comma-separated argument string into a TypedArg array.
   * Primitive coercion rules (left to right):
   * - `"true"` / `"false"` → boolean
   * - numeric string (integer) → number
   * - everything else → plain string
   */
  const parseArgs = useCallback((raw: string): TypedArg[] => {
    if (!raw.trim()) return [];
    return raw.split(',').map((token): TypedArg => {
      const t = token.trim();
      if (t === 'true') return true;
      if (t === 'false') return false;
      const n = Number(t);
      if (t !== '' && !isNaN(n) && Number.isInteger(n)) return n;
      return t;
    });
  }, []);

  /**
   * Validate every field and build the call arguments. With a spec-selected
   * function each argument has its own typed field; otherwise the
   * comma-separated input is checked for empty entries.
   */
  const collectArgs = useCallback((): { args: TypedArg[]; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    const fnError = validateFunctionName(fnName);
    if (fnError) errors['ccf-fn-name'] = fnError;

    if (specArgs) {
      const args = specArgs.map((arg, index) => {
        const value = argValues[index] ?? '';
        const argError = validateArgValue(value, arg.type);
        if (argError) errors[argFieldId(index)] = argError;
        return coerceTypedArg(value, arg.type);
      });
      return { args, errors };
    }

    if (rawArgs.trim()) {
      const emptyIndex = rawArgs.split(',').findIndex((token) => !token.trim());
      if (emptyIndex !== -1) {
        errors['ccf-args'] = `Argument ${emptyIndex + 1} is empty. Remove the extra comma or enter a value.`;
      }
    }
    return { args: parseArgs(rawArgs), errors };
  }, [fnName, specArgs, argValues, rawArgs, parseArgs]);

  /**
   * Show validation errors and move focus to the first invalid field, so
   * keyboard and screen-reader users land on the problem.
   * @returns `true` when the form is valid.
   */
  const applyValidation = useCallback((errors: Record<string, string>): boolean => {
    setFieldErrors(errors);
    const ids = Object.keys(errors);
    if (ids.length === 0) return true;
    const order = ['ccf-fn-name', 'ccf-args', ...(specArgs ?? []).map((_, i) => argFieldId(i))];
    const first = order.find((id) => id in errors) ?? ids[0];
    if (typeof document !== 'undefined') {
      document.getElementById(first)?.focus();
    }
    return false;
  }, [specArgs]);

  /** Step 1 — run the simulation and show the preview. */
  const handlePreview = useCallback(async () => {
    setPreview(undefined);
    setSubmitError(null);

    const { args, errors } = collectArgs();
    if (!applyValidation(errors)) return;

    const sim: SimulateContractCallResult = await simulateContractCall(
      fnName.trim(),
      args
    );
    setPreview(sim);
  }, [fnName, collectArgs, applyValidation, simulateContractCall]);

  /** Step 2 — build unsigned XDR and call onSubmit. */
  const handleConfirm = useCallback(async () => {
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const { args, errors } = collectArgs();
      if (!applyValidation(errors)) return;
      const xdr = await buildInvokeXDR(fnName.trim(), args);
      if (onSubmit) {
        await onSubmit(xdr);
      } else {
        // eslint-disable-next-line no-console
        console.log('[ContractCallForm] Unsigned XDR:', xdr);
      }
      // Reset form after successful submission
      setPreview(undefined);
      setFnName('');
      setRawArgs('');
      setArgValues([]);
      setFieldErrors({});
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setSubmitLoading(false);
    }
  }, [fnName, collectArgs, applyValidation, buildInvokeXDR, onSubmit]);

  /** Cancel preview and return to editing. */
  const handleCancel = useCallback(() => {
    setPreview(undefined);
    setSubmitError(null);
  }, []);

  const isPreviewDisabled = loading || submitLoading || !fnName.trim();
  const displayError = error ?? submitError;

  /** ARIA wiring for a field: invalid state plus description ids. */
  const fieldA11y = (fieldId: string, extraDescribedBy?: string) => {
    const hasError = Boolean(fieldErrors[fieldId]);
    const describedBy = [extraDescribedBy, hasError ? errorIdFor(fieldId) : undefined]
      .filter(Boolean)
      .join(' ');
    return {
      'aria-invalid': hasError ? (true as const) : undefined,
      'aria-describedby': describedBy || undefined,
    };
  };

  /** The announced error message for a field, if it has one. */
  const renderFieldError = (fieldId: string) =>
    fieldErrors[fieldId] ? (
      <p
        id={errorIdFor(fieldId)}
        role="alert"
        className="mt-1 text-xs text-red-600 dark:text-red-400"
      >
        {fieldErrors[fieldId]}
      </p>
    ) : null;

  const handleFnNameChange = (value: string) => {
    setFnName(value);
    setPreview(undefined);
    clearFieldError('ccf-fn-name');
    const nextSpec = specFunctions?.find((fn) => fn.name === value);
    // Fresh, empty fields for the newly selected function's arguments.
    setArgValues(nextSpec ? nextSpec.args.map(() => '') : []);
    setFieldErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [id, message] of Object.entries(prev)) {
        if (!id.startsWith('ccf-arg-') && id !== 'ccf-fn-name') next[id] = message;
      }
      return next;
    });
  };

  return (
    <div className={`w-full max-w-lg space-y-4 ${className}`.trim()}>
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Call Contract Function
      </h2>

      {/* Function name */}
      <div>
        <label
          htmlFor="ccf-fn-name"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Function name
        </label>
        {specFunctions && specFunctions.length > 0 ? (
          <select
            id="ccf-fn-name"
            value={fnName}
            onChange={(e) => handleFnNameChange(e.target.value)}
            {...fieldA11y('ccf-fn-name')}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="" disabled>
              Select a function…
            </option>
            {specFunctions.map((fn) => (
              <option key={fn.name} value={fn.name}>
                {fn.name}
                {fn.args.length > 0
                  ? ` (${fn.args.map((a) => `${a.name}: ${a.type}`).join(', ')})`
                  : ' ()'}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="ccf-fn-name"
            type="text"
            value={fnName}
            onChange={(e) => handleFnNameChange(e.target.value)}
            {...fieldA11y('ccf-fn-name')}
            placeholder={specLoading ? 'Loading contract functions…' : 'e.g. transfer'}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        )}
        {renderFieldError('ccf-fn-name')}
      </div>

      {/* Arguments: one typed field per spec argument, or a comma-separated input */}
      {specArgs ? (
        specArgs.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
              Arguments
            </legend>
            {specArgs.map((arg, index) => {
              const id = argFieldId(index);
              return (
                <div key={`${selectedSpec?.name}-${arg.name}-${index}`}>
                  <label
                    htmlFor={id}
                    className="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                  >
                    {arg.name}{' '}
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      ({arg.type})
                    </span>
                  </label>
                  <input
                    id={id}
                    type="text"
                    value={argValues[index] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setArgValues((prev) => {
                        const next = [...prev];
                        next[index] = value;
                        return next;
                      });
                      setPreview(undefined);
                      clearFieldError(id);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    {...fieldA11y(id)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                  />
                  {renderFieldError(id)}
                </div>
              );
            })}
          </fieldset>
        )
      ) : (
        <div>
          <label
            htmlFor="ccf-args"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Arguments{' '}
            <span className="font-normal text-gray-400 dark:text-gray-500">
              (comma-separated, optional)
            </span>
          </label>
          <input
            id="ccf-args"
            type="text"
            value={rawArgs}
            onChange={(e) => {
              setRawArgs(e.target.value);
              setPreview(undefined);
              clearFieldError('ccf-args');
            }}
            {...fieldA11y('ccf-args', 'ccf-args-hint')}
            placeholder="e.g. GABC…, 1000, true"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <p id="ccf-args-hint" className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Strings, integers, and booleans are auto-detected. For advanced types
            (u128, bytes, etc.) use the{' '}
            <code className="font-mono">useSorobanContract</code> hook directly.
          </p>
          {renderFieldError('ccf-args')}
        </div>
      )}

      {/* Preview button */}
      {!preview && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewDisabled}
          className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300 transition-colors"
        >
          {loading ? 'Simulating…' : 'Preview'}
        </button>
      )}

      {/* Simulation preview panel */}
      <ContractCallPreview
        preview={preview}
        loading={loading}
        error={displayError}
        onConfirm={preview ? handleConfirm : undefined}
        onCancel={preview || displayError ? handleCancel : undefined}
      />

      {/* Submit-phase loading indicator (shown while buildInvokeXDR runs) */}
      {submitLoading && (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-sm text-gray-500 dark:text-gray-400"
        >
          Building transaction…
        </p>
      )}
    </div>
  );
}
