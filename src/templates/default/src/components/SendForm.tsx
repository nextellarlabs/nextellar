'use client';

import { useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useWallet, isUnsignedFeeBumpResult } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';
import { useFederationLookup } from '../hooks/useFederationLookup';
import { MEMO_TYPES, validateMemo, type MemoType, type PaymentMemo } from '../lib/memo';
import TransactionStatusBadge from './TransactionStatusBadge';

type FormState = 'idle' | 'submitting' | 'success' | 'error' | 'awaiting_sponsor';

const MEMO_TYPE_LABELS: Record<MemoType, string> = {
  none: 'None',
  text: 'Text',
  id: 'ID',
  hash: 'Hash',
  return: 'Return',
};

const MEMO_PLACEHOLDERS: Record<MemoType, string> = {
  none: '',
  text: 'Up to 28 bytes',
  id: 'e.g. 1234567890',
  hash: '64 hex characters',
  return: '64 hex characters (refund tx hash)',
};

function shortKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}

/**
 * Send Form
 *
 * A payment form for the connected wallet: destination address, asset selector,
 * amount, optional memo, and optional fee-bump sponsor key.
 *
 * The destination can be a G… public key or a SEP-2 federation address
 * (`name*domain.com`), which is resolved to an account id as you type. When
 * the federation server requires a memo (exchanges often do), the memo is
 * pre-filled and locked so the payment cannot be sent without it.
 *
 * Memo types: none / text (≤ 28 bytes) / id (uint64) / hash and return
 * (32 bytes as 64 hex chars), each validated before submit.
 *
 * A fee-bump's outer envelope must be signed by the sponsor's own key, which
 * this form has no channel to obtain (only their public key is collected) —
 * so when a sponsor is set, submitting signs and builds the fee-bump
 * transaction but does not submit it. The resulting XDR is shown for the
 * sponsor to sign and submit themselves (e.g. paste into their own wallet).
 */
export default function SendForm() {
  const { connected, publicKey, sendPayment } = useWallet();
  const { balances } = useStellarBalances(publicKey || undefined);
  const [to, setTo] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<string>('XLM');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [memoType, setMemoType] = useState<MemoType>('text');
  const [sponsor, setSponsor] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [feeBumpXdr, setFeeBumpXdr] = useState<string | null>(null);

  const federation = useFederationLookup(to);
  const isFederation = to.includes('*');
  const destination = isFederation
    ? federation.status === 'resolved'
      ? federation.record?.accountId ?? null
      : null
    : to;

  const addressError = isFederation
    ? federation.status === 'error'
      ? federation.error
      : null
    : to.length > 0 && !StrKey.isValidEd25519PublicKey(to)
      ? 'Enter a valid Stellar public key (starts with G) or a federation address (name*domain.com).'
      : null;

  // A memo required by the federation server overrides (and locks) the field.
  const lockedMemo: PaymentMemo | undefined =
    isFederation && federation.status === 'resolved' ? federation.record?.memo : undefined;
  const effectiveMemoType: MemoType = lockedMemo?.type ?? memoType;
  const effectiveMemo = lockedMemo?.value ?? (memoType === 'none' ? '' : memo);

  const memoError =
    effectiveMemoType !== 'text' && effectiveMemoType !== 'none' && effectiveMemo.length === 0
      ? `Enter a ${MEMO_TYPE_LABELS[effectiveMemoType]} memo or choose None.`
      : validateMemo(effectiveMemoType, effectiveMemo);

  const sponsorError =
    sponsor.length > 0 && !StrKey.isValidEd25519PublicKey(sponsor)
      ? 'Enter a valid sponsor public key (starts with G).'
      : null;

  const amountError =
    amount.length > 0 && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      ? 'Enter an amount greater than 0.'
      : null;

  const canSubmit =
    connected &&
    !!sendPayment &&
    !!destination &&
    amount.length > 0 &&
    !addressError &&
    !sponsorError &&
    !amountError &&
    !memoError &&
    state !== 'submitting';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendPayment || !destination || addressError || sponsorError || amountError || memoError) return;

    setState('submitting');
    setError(null);
    setFeeBumpXdr(null);
    try {
      const assetParam =
        selectedAsset === 'XLM'
          ? 'XLM'
          : (() => {
              const matched = balances.find(
                (b) => b.asset_code === selectedAsset || `${b.asset_code}:${b.asset_issuer}` === selectedAsset
              );
              return matched && matched.asset_code && matched.asset_issuer
                ? { code: matched.asset_code, issuer: matched.asset_issuer }
                : 'XLM';
            })();

      // Text memos are passed as a plain string (backwards compatible with
      // PaymentOptions.memo); other types as { type, value }.
      const memoParam: string | PaymentMemo | undefined =
        effectiveMemoType === 'none' || effectiveMemo === ''
          ? undefined
          : effectiveMemoType === 'text'
            ? effectiveMemo
            : { type: effectiveMemoType, value: effectiveMemo };

      // With a sponsor, sendPayment returns the unsigned fee-bump XDR for the
      // sponsor to sign out-of-band (see WalletProvider PaymentOptions.sponsor).
      const result = await sendPayment({
        to: destination,
        amount,
        asset: assetParam,
        memo: memoParam,
        sponsor: sponsor || undefined,
      });

      if (isUnsignedFeeBumpResult(result)) {
        setFeeBumpXdr(result.feeBumpXdr);
        setState('awaiting_sponsor');
      } else {
        setState('success');
        setTo('');
        setAmount('');
        setMemo('');
        setMemoType('text');
        setSponsor('');
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Send Payment</h3>
        {state !== 'idle' && (
          <TransactionStatusBadge
            status={
              state === 'submitting' || state === 'awaiting_sponsor'
                ? 'pending'
                : state === 'success'
                  ? 'success'
                  : 'failed'
            }
            label={
              state === 'submitting'
                ? 'Submitting'
                : state === 'awaiting_sponsor'
                  ? 'Awaiting sponsor'
                  : state === 'success'
                    ? 'Sent'
                    : 'Failed'
            }
          />
        )}
      </div>

      <div>
        <label htmlFor="send-form-to" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          To
        </label>
        <input
          id="send-form-to"
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="GABC...1234 or name*domain.com"
          disabled={!connected || state === 'submitting'}
          aria-invalid={!!addressError}
          aria-describedby="send-form-to-error send-form-to-federation"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <p
          id="send-form-to-federation"
          aria-live="polite"
          data-testid="send-form-federation"
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
        >
          {isFederation && federation.status === 'resolving' ? 'Resolving federation address…' : ''}
          {isFederation && federation.status === 'resolved' && federation.record ? (
            <span title={federation.record.accountId} className="font-mono">
              Resolves to {shortKey(federation.record.accountId)}
            </span>
          ) : null}
        </p>
        <p
          id="send-form-to-error"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
        >
          {addressError ?? ''}
        </p>
      </div>

      {balances && balances.length > 1 && (
        <div>
          <label htmlFor="send-form-asset" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
            Asset
          </label>
          <select
            id="send-form-asset"
            value={selectedAsset}
            onChange={(e) => setSelectedAsset(e.target.value)}
            disabled={!connected || state === 'submitting'}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="XLM">XLM (Native)</option>
            {balances
              .filter((b) => b.asset_type !== 'native' && b.asset_code)
              .map((b) => (
                <option key={`${b.asset_code}:${b.asset_issuer}`} value={b.asset_code}>
                  {b.asset_code} ({parseFloat(b.balance).toFixed(2)})
                </option>
              ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="send-form-amount" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          Amount ({selectedAsset})
        </label>
        <input
          id="send-form-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          disabled={!connected || state === 'submitting'}
          aria-invalid={!!amountError}
          aria-describedby="send-form-amount-error"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <p
          id="send-form-amount-error"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
        >
          {amountError ?? ''}
        </p>
      </div>

      <div>
        <label htmlFor="send-form-memo-type" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          Memo type
        </label>
        <select
          id="send-form-memo-type"
          value={effectiveMemoType}
          onChange={(e) => setMemoType(e.target.value as MemoType)}
          disabled={!connected || state === 'submitting' || !!lockedMemo}
          className="mb-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          {MEMO_TYPES.map((type) => (
            <option key={type} value={type}>
              {MEMO_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <label htmlFor="send-form-memo" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          Memo (optional)
        </label>
        <input
          id="send-form-memo"
          type="text"
          value={effectiveMemo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={MEMO_PLACEHOLDERS[effectiveMemoType]}
          readOnly={!!lockedMemo}
          disabled={!connected || state === 'submitting' || effectiveMemoType === 'none'}
          aria-invalid={!!memoError}
          aria-describedby="send-form-memo-error send-form-memo-locked"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 read-only:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:read-only:bg-gray-700"
        />
        <p id="send-form-memo-locked" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {lockedMemo && federation.record
            ? `Memo required by ${federation.record.stellarAddress} (locked).`
            : ''}
        </p>
        <p
          id="send-form-memo-error"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
        >
          {memoError ?? ''}
        </p>
      </div>

      <div>
        <label htmlFor="send-form-sponsor" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          Fee Sponsor (optional fee-bump)
        </label>
        <input
          id="send-form-sponsor"
          type="text"
          value={sponsor}
          onChange={(e) => setSponsor(e.target.value)}
          placeholder="GSPONSOR...1234"
          disabled={!connected || state === 'submitting'}
          aria-invalid={!!sponsorError}
          aria-describedby="send-form-sponsor-error"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <p
          id="send-form-sponsor-error"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-1 min-h-[1rem] text-xs text-red-600 dark:text-red-400"
        >
          {sponsorError ?? ''}
        </p>
      </div>

      {!connected && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Connect a wallet to send a payment.</p>
      )}
      {connected && !sendPayment && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The connected wallet adapter does not support sending payments.
        </p>
      )}
      <p
        aria-live="assertive"
        aria-atomic="true"
        className="min-h-[1rem] text-xs text-red-600 dark:text-red-400"
      >
        {error ?? ''}
      </p>

      {state === 'awaiting_sponsor' && feeBumpXdr && (
        <div
          role="status"
          aria-live="polite"
          className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
        >
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            This transaction is signed and ready, but needs the fee sponsor&apos;s
            signature before it can be submitted. This wallet has no way to sign
            on the sponsor&apos;s behalf — copy the XDR below and have the sponsor
            sign and submit it from their own wallet.
          </p>
          <textarea
            readOnly
            value={feeBumpXdr}
            aria-label="Unsigned fee-bump transaction XDR"
            rows={4}
            className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 font-mono text-[11px] text-gray-800 dark:border-amber-700 dark:bg-gray-900 dark:text-gray-200"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {state === 'submitting' ? 'Sending…' : sponsor ? 'Send with Fee-Bump' : 'Send'}
      </button>
    </form>
  );
}

