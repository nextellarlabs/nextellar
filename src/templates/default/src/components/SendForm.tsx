'use client';

import { useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useWallet } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';
import TransactionStatusBadge from './TransactionStatusBadge';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Send Form
 *
 * A payment form for the connected wallet: destination address, asset selector,
 * amount, optional memo, and optional fee-bump sponsor key.
 */
export default function SendForm() {
  const { connected, address, sendPayment } = useWallet();
  const { balances } = useStellarBalances(address || undefined);
  const [to, setTo] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<string>('XLM');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  const addressError =
    to.length > 0 && !StrKey.isValidEd25519PublicKey(to)
      ? 'Enter a valid Stellar public key (starts with G).'
      : null;

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
    to.length > 0 &&
    amount.length > 0 &&
    !addressError &&
    !sponsorError &&
    !amountError &&
    state !== 'submitting';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendPayment || addressError || sponsorError || amountError) return;

    setState('submitting');
    setError(null);
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

      await sendPayment({
        to,
        amount,
        asset: assetParam,
        memo: memo || undefined,
        sponsor: sponsor || undefined,
      });
      setState('success');
      setTo('');
      setAmount('');
      setMemo('');
      setSponsor('');
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
            status={state === 'submitting' ? 'pending' : state === 'success' ? 'success' : 'failed'}
            label={state === 'submitting' ? 'Submitting' : state === 'success' ? 'Sent' : 'Failed'}
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
          placeholder="GABC...1234"
          disabled={!connected || state === 'submitting'}
          aria-invalid={!!addressError}
          aria-describedby="send-form-to-error"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
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
        <label htmlFor="send-form-memo" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          Memo (optional)
        </label>
        <input
          id="send-form-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={!connected || state === 'submitting'}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
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

