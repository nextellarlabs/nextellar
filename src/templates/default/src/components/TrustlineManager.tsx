'use client';

import { useState, useContext, useId, useMemo } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { WalletContext } from '../contexts/WalletProvider';
import { I18nContext, type Messages } from '../contexts/I18nProvider';
import { en } from '../locales/en';
import { useTrustlines, type Trustline } from '../hooks/useTrustlines';
import TransactionStatusBadge from './TransactionStatusBadge';

/** Base reserve per trustline subentry on Stellar (0.5 XLM). */
export const TRUSTLINE_BASE_RESERVE_XLM = 0.5;

type ActionState = 'idle' | 'pending' | 'success' | 'error';

export interface TrustlineChangeAction {
  type: 'add' | 'remove';
  assetCode: string;
  assetIssuer: string;
  limit?: string;
}

export interface TrustlineManagerProps {
  /** Override public key (defaults to the connected wallet's public key). */
  publicKey?: string | null;
  /** Optional Horizon URL passed through to `useTrustlines`. */
  horizonUrl?: string;
  /** Optional Stellar network passed through to `useTrustlines`. */
  network?: 'TESTNET' | 'PUBLIC';
  /**
   * Optional callback to sign and submit the unsigned change-trust XDR
   * built by `useTrustlines`. When omitted, the unsigned XDR is displayed
   * for out-of-band signing.
   */
  onSignAndSubmit?: (
    xdr: string,
    action: TrustlineChangeAction,
  ) => Promise<void | { hash?: string }>;
}

type TrustlineMessageKey = `trustlines.${keyof Messages['trustlines']}`;

function resolveFallback(path: TrustlineMessageKey, params?: Record<string, string | number>): string {
  const key = path.slice('trustlines.'.length) as keyof Messages['trustlines'];
  const template: string = en.trustlines[key] ?? path;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match,
  );
}

function useTrustlineTranslation() {
  const i18n = useContext(I18nContext);
  return (path: TrustlineMessageKey, params?: Record<string, string | number>): string => {
    if (i18n) {
      return i18n.t(path, params);
    }
    return resolveFallback(path, params);
  };
}

function shortKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

/**
 * Returns true when a trustline holds a strictly positive balance and
 * therefore cannot be removed on Stellar.
 */
export function hasNonZeroBalance(balance?: string): boolean {
  if (!balance) return false;
  const numeric = Number(balance);
  return Number.isFinite(numeric) && numeric > 0;
}

function isValidAssetCode(code: string): boolean {
  return /^[A-Za-z0-9]{1,12}$/.test(code);
}

/**
 * Trustline Manager
 *
 * Unified UI for viewing, adding, and removing Stellar asset trustlines.
 * - Uses `useTrustlines` for loading trustlines and building change-trust XDRs.
 * - Blocks removal of trustlines with a non-zero balance.
 * - Displays the 0.5 XLM base reserve impact for adding and removing trustlines.
 * - Routes all UI copy through `I18nProvider` (with an English fallback).
 */
export default function TrustlineManager({
  publicKey: publicKeyProp,
  horizonUrl,
  network,
  onSignAndSubmit,
}: TrustlineManagerProps) {
  const wallet = useContext(WalletContext);
  const t = useTrustlineTranslation();
  const baseId = useId();

  const effectivePublicKey = publicKeyProp !== undefined ? publicKeyProp : wallet?.publicKey ?? null;
  const isConnected = Boolean(effectivePublicKey);

  const { trustlines, loading, error, refresh, buildChangeTrustXDR } = useTrustlines(
    effectivePublicKey,
    { horizonUrl, network },
  );

  const [assetCode, setAssetCode] = useState('');
  const [assetIssuer, setAssetIssuer] = useState('');
  const [limit, setLimit] = useState('');

  const [actionState, setActionState] = useState<ActionState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [unsignedXdr, setUnsignedXdr] = useState<string | null>(null);
  const [copiedXdr, setCopiedXdr] = useState(false);

  const trimmedCode = assetCode.trim();
  const trimmedIssuer = assetIssuer.trim();
  const trimmedLimit = limit.trim();

  const codeError =
    trimmedCode.length > 0 && !isValidAssetCode(trimmedCode)
      ? t('trustlines.validationAssetCode')
      : null;

  const issuerError =
    trimmedIssuer.length > 0 && !StrKey.isValidEd25519PublicKey(trimmedIssuer)
      ? t('trustlines.validationIssuer')
      : null;

  const limitError =
    trimmedLimit.length > 0 && (!Number.isFinite(Number(trimmedLimit)) || Number(trimmedLimit) <= 0)
      ? t('trustlines.validationLimit')
      : null;

  const isDuplicate = useMemo(
    () =>
      trimmedCode.length > 0 &&
      trimmedIssuer.length > 0 &&
      trustlines.some(
        (tl) =>
          tl.asset_code.toUpperCase() === trimmedCode.toUpperCase() &&
          tl.asset_issuer === trimmedIssuer,
      ),
    [trustlines, trimmedCode, trimmedIssuer],
  );

  const duplicateError = isDuplicate ? t('trustlines.validationDuplicate') : null;

  const isSubmitting = actionState === 'pending';
  const canAdd =
    isConnected &&
    !isSubmitting &&
    trimmedCode.length > 0 &&
    trimmedIssuer.length > 0 &&
    !codeError &&
    !issuerError &&
    !limitError &&
    !duplicateError;

  const totalReservedXlm = (trustlines.length * TRUSTLINE_BASE_RESERVE_XLM).toFixed(1);
  const reserveDelta = TRUSTLINE_BASE_RESERVE_XLM.toFixed(1);

  const handleAddTrustline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;

    setActionState('pending');
    setPendingKey('add');
    setActionError(null);
    setStatusMessage(null);
    setUnsignedXdr(null);
    setCopiedXdr(false);

    try {
      const xdr = await buildChangeTrustXDR({
        code: trimmedCode,
        issuer: trimmedIssuer,
        limit: trimmedLimit || undefined,
      });

      if (onSignAndSubmit) {
        await onSignAndSubmit(xdr, {
          type: 'add',
          assetCode: trimmedCode,
          assetIssuer: trimmedIssuer,
          limit: trimmedLimit || undefined,
        });
        await refresh();
      } else {
        setUnsignedXdr(xdr);
      }

      setActionState('success');
      setStatusMessage(t('trustlines.actionSuccessAdd', { asset: trimmedCode }));
      setAssetCode('');
      setAssetIssuer('');
      setLimit('');
    } catch (err) {
      setActionState('error');
      setActionError(err instanceof Error ? err.message : t('trustlines.actionErrorFallback'));
    } finally {
      setPendingKey(null);
    }
  };

  const handleRemoveTrustline = async (trustline: Trustline) => {
    if (!isConnected || isSubmitting || hasNonZeroBalance(trustline.balance)) {
      return;
    }

    const rowKey = `${trustline.asset_code}:${trustline.asset_issuer}`;
    setActionState('pending');
    setPendingKey(rowKey);
    setActionError(null);
    setStatusMessage(null);
    setUnsignedXdr(null);
    setCopiedXdr(false);

    try {
      const xdr = await buildChangeTrustXDR({
        code: trustline.asset_code,
        issuer: trustline.asset_issuer,
        limit: '0',
      });

      if (onSignAndSubmit) {
        await onSignAndSubmit(xdr, {
          type: 'remove',
          assetCode: trustline.asset_code,
          assetIssuer: trustline.asset_issuer,
          limit: '0',
        });
        await refresh();
      } else {
        setUnsignedXdr(xdr);
      }

      setActionState('success');
      setStatusMessage(t('trustlines.actionSuccessRemove', { asset: trustline.asset_code }));
    } catch (err) {
      setActionState('error');
      setActionError(err instanceof Error ? err.message : t('trustlines.actionErrorFallback'));
    } finally {
      setPendingKey(null);
    }
  };

  const handleCopyXdr = async () => {
    if (!unsignedXdr || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(unsignedXdr);
      setCopiedXdr(true);
    } catch {
      // Clipboard write may be denied in restricted contexts.
    }
  };

  const titleId = `${baseId}-title`;
  const codeInputId = `${baseId}-code`;
  const codeErrorId = `${baseId}-code-error`;
  const issuerInputId = `${baseId}-issuer`;
  const issuerErrorId = `${baseId}-issuer-error`;
  const limitInputId = `${baseId}-limit`;
  const limitErrorId = `${baseId}-limit-error`;
  const addReserveId = `${baseId}-add-reserve`;

  return (
    <section
      aria-labelledby={titleId}
      className="w-full max-w-lg space-y-5 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
            {t('trustlines.title')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('trustlines.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {actionState !== 'idle' && (
            <TransactionStatusBadge
              status={
                actionState === 'pending'
                  ? 'pending'
                  : actionState === 'success'
                    ? 'success'
                    : 'failed'
              }
              label={
                actionState === 'pending'
                  ? t('trustlines.statusPending')
                  : actionState === 'success'
                    ? t('trustlines.statusSuccess')
                    : t('trustlines.statusFailed')
              }
            />
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!isConnected || loading || isSubmitting}
            aria-label={t('trustlines.refreshAriaLabel')}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {loading ? t('trustlines.refreshing') : t('trustlines.refresh')}
          </button>
        </div>
      </div>

      {/* Disconnected state */}
      {!isConnected && (
        <p
          role="status"
          className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
        >
          {t('trustlines.connectPrompt')}
        </p>
      )}

      {/* Reserve summary */}
      {isConnected && (
        <div
          data-testid="trustline-reserve-summary"
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
        >
          {trustlines.length === 1
            ? t('trustlines.reserveSummarySingle', { amount: totalReservedXlm })
            : t('trustlines.reserveSummary', {
                count: trustlines.length,
                amount: totalReservedXlm,
              })}
        </div>
      )}

      {/* Add Trustline Form */}
      <form onSubmit={handleAddTrustline} noValidate className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('trustlines.addSectionTitle')}
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor={codeInputId}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('trustlines.assetCodeLabel')}
            </label>
            <input
              id={codeInputId}
              type="text"
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder={t('trustlines.assetCodePlaceholder')}
              disabled={!isConnected || isSubmitting}
              aria-invalid={Boolean(codeError || duplicateError)}
              aria-describedby={codeErrorId}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <p
              id={codeErrorId}
              aria-live="assertive"
              className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
            >
              {codeError ?? duplicateError ?? ''}
            </p>
          </div>

          <div>
            <label
              htmlFor={limitInputId}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t('trustlines.limitLabel')}
            </label>
            <input
              id={limitInputId}
              type="text"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={t('trustlines.limitPlaceholder')}
              disabled={!isConnected || isSubmitting}
              aria-invalid={Boolean(limitError)}
              aria-describedby={limitErrorId}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <p
              id={limitErrorId}
              aria-live="assertive"
              className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
            >
              {limitError ?? ''}
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor={issuerInputId}
            className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {t('trustlines.assetIssuerLabel')}
          </label>
          <input
            id={issuerInputId}
            type="text"
            value={assetIssuer}
            onChange={(e) => setAssetIssuer(e.target.value)}
            placeholder={t('trustlines.assetIssuerPlaceholder')}
            disabled={!isConnected || isSubmitting}
            aria-invalid={Boolean(issuerError)}
            aria-describedby={`${issuerErrorId} ${addReserveId}`}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <p
            id={issuerErrorId}
            aria-live="assertive"
            className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
          >
            {issuerError ?? ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            id={addReserveId}
            data-testid="add-reserve-impact"
            className="text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            {t('trustlines.addReserveImpact', { amount: reserveDelta })}
          </p>
          <button
            type="submit"
            disabled={!canAdd}
            className="rounded-md bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {pendingKey === 'add' ? t('trustlines.addingButton') : t('trustlines.addButton')}
          </button>
        </div>
      </form>

      {/* Action feedback */}
      {statusMessage && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
        >
          {statusMessage}
        </p>
      )}

      {actionError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {actionError}
        </p>
      )}

      {unsignedXdr && (
        <div
          role="region"
          aria-label={t('trustlines.xdrReadyTitle')}
          className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-900 dark:text-white">
              {t('trustlines.xdrReadyTitle')}
            </p>
            <button
              type="button"
              onClick={() => void handleCopyXdr()}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              {copiedXdr ? t('trustlines.copiedXdr') : t('trustlines.copyXdr')}
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {t('trustlines.xdrReadyDescription')}
          </p>
          <code className="block max-h-20 overflow-auto break-all rounded bg-white p-2 font-mono text-[11px] text-gray-800 dark:bg-gray-900 dark:text-gray-200">
            {unsignedXdr}
          </code>
        </div>
      )}

      {/* Existing Trustlines List */}
      <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('trustlines.listSectionTitle')}
        </h3>

        {loading && (
          <p role="status" aria-live="polite" className="text-xs text-gray-500 dark:text-gray-400">
            {t('trustlines.loading')}
          </p>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          >
            <span>{t('trustlines.errorPrefix', { message: error.message })}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
            >
              {t('trustlines.retry')}
            </button>
          </div>
        )}

        {!loading && !error && isConnected && trustlines.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('trustlines.empty')}</p>
        )}

        {!loading && !error && trustlines.length > 0 && (
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            {trustlines.map((tl) => {
              const rowKey = `${tl.asset_code}:${tl.asset_issuer}`;
              const nonZero = hasNonZeroBalance(tl.balance);
              const isRemoving = pendingKey === rowKey;
              const warningId = `${baseId}-warn-${tl.asset_code}-${tl.asset_issuer.slice(0, 6)}`;
              const reserveId = `${baseId}-res-${tl.asset_code}-${tl.asset_issuer.slice(0, 6)}`;

              return (
                <li
                  key={rowKey}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {tl.asset_code}
                      </span>
                      {tl.authorized === true && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                          {t('trustlines.authorizedBadge')}
                        </span>
                      )}
                      {tl.authorized === false && tl.authorizedToMaintainLiabilities === true && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {t('trustlines.maintainLiabilitiesBadge')}
                        </span>
                      )}
                      {tl.authorized === false && !tl.authorizedToMaintainLiabilities && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                          {t('trustlines.unauthorizedBadge')}
                        </span>
                      )}
                    </div>

                    <p
                      title={tl.asset_issuer}
                      className="truncate font-mono text-xs text-gray-500 dark:text-gray-400"
                    >
                      {t('trustlines.issuerLabel', { issuer: shortKey(tl.asset_issuer) })}
                    </p>

                    <div className="flex flex-wrap gap-3 text-xs text-gray-700 dark:text-gray-300">
                      <span>{t('trustlines.balanceLabel', { balance: tl.balance ?? '0' })}</span>
                      {tl.limit && (
                        <span>{t('trustlines.limitDisplayLabel', { limit: tl.limit })}</span>
                      )}
                    </div>

                    <p
                      id={reserveId}
                      className="text-xs text-emerald-700 dark:text-emerald-400"
                    >
                      {t('trustlines.removeReserveImpact', { amount: reserveDelta })}
                    </p>

                    {nonZero && (
                      <p
                        id={warningId}
                        className="text-xs text-amber-700 dark:text-amber-400"
                      >
                        {t('trustlines.nonZeroBalanceWarning')}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleRemoveTrustline(tl)}
                      disabled={nonZero || isSubmitting}
                      aria-label={t('trustlines.removeAriaLabel', { asset: tl.asset_code })}
                      aria-describedby={nonZero ? warningId : reserveId}
                      className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      {isRemoving ? t('trustlines.removingButton') : t('trustlines.removeButton')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
