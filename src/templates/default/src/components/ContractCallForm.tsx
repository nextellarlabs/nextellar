'use client';

import { useState, useCallback, useEffect } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import {
  useSorobanContract,
  type SimulateContractCallResult,
  type TypedArg,
} from '../hooks/useSorobanContract';
import { fetchContractSpec, type ContractFunctionSpec } from '../lib/contract-spec';
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

  /** Step 1 — run the simulation and show the preview. */
  const handlePreview = useCallback(async () => {
    setPreview(undefined);
    setSubmitError(null);

    const args = parseArgs(rawArgs);
    const sim: SimulateContractCallResult = await simulateContractCall(
      fnName.trim(),
      args
    );
    setPreview(sim);
  }, [fnName, rawArgs, parseArgs, simulateContractCall]);

  /** Step 2 — build unsigned XDR and call onSubmit. */
  const handleConfirm = useCallback(async () => {
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const args = parseArgs(rawArgs);
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
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setSubmitLoading(false);
    }
  }, [fnName, rawArgs, parseArgs, buildInvokeXDR, onSubmit]);

  /** Cancel preview and return to editing. */
  const handleCancel = useCallback(() => {
    setPreview(undefined);
    setSubmitError(null);
  }, []);

  const isPreviewDisabled = loading || submitLoading || !fnName.trim();
  const displayError = error ?? submitError;

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
            onChange={(e) => {
              setFnName(e.target.value);
              setPreview(undefined);
            }}
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
            onChange={(e) => {
              setFnName(e.target.value);
              setPreview(undefined);
            }}
            placeholder={specLoading ? 'Loading contract functions…' : 'e.g. transfer'}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        )}
      </div>

      {/* Arguments */}
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
          }}
          placeholder="e.g. GABC…, 1000, true"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Strings, integers, and booleans are auto-detected. For advanced types
          (u128, bytes, etc.) use the{' '}
          <code className="font-mono">useSorobanContract</code> hook directly.
        </p>
      </div>

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
