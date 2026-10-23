'use client';

import { useMemo, useState } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import { useWallet, useWalletConfig } from '../contexts';
import { usePathPayment, type PathPaymentMode } from '../hooks/usePathPayment';
import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  assetLabel,
  describePath,
  isValidAmount,
  maxSendAmount,
  minReceiveAmount,
  sameAsset,
  type PathQuote,
  type SwapAsset,
} from '../lib/pathPayment';
import TransactionStatusBadge from './TransactionStatusBadge';

type FormState = 'idle' | 'searching' | 'quoted' | 'submitting' | 'success' | 'error';

const XLM_KEY = 'XLM';

const assetKey = (asset: SwapAsset) =>
  asset === 'XLM' ? XLM_KEY : `${asset.code}:${asset.issuer}`;

const keyToAsset = (key: string): SwapAsset => {
  if (key === XLM_KEY) return 'XLM';
  const [code, issuer] = key.split(':');
  return { code, issuer };
};

/**
 * Swap Form
 *
 * A DEX swap using Stellar path payments. The user picks a source and
 * destination asset, chooses whether the amount to send is fixed
 * (strict-send) or the amount to receive is fixed (strict-receive), and sets
 * a slippage tolerance. "Find route" asks Horizon for the best path and shows
 * the route, the estimate and the slippage-protected bound (minimum received
 * or maximum sent) before anything is signed.
 */
export default function SwapForm() {
  const { connected, publicKey, balances, signTransaction } = useWallet();
  const config = useWalletConfig();
  const { findBestPath, buildPathPaymentXDR, submitSignedXDR } = usePathPayment({
    network: config?.network === Networks.PUBLIC ? 'PUBLIC' : 'TESTNET',
  });

  const [mode, setMode] = useState<PathPaymentMode>('strict-send');
  const [sourceKey, setSourceKey] = useState(XLM_KEY);
  const [destinationKey, setDestinationKey] = useState('');
  const [amount, setAmount] = useState('');
  const [slippagePercent, setSlippagePercent] = useState(String(DEFAULT_SLIPPAGE_BPS / 100));
  const [quote, setQuote] = useState<PathQuote | null>(null);
  const [state, setState] = useState<FormState>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const assetOptions = useMemo(() => {
    const options: SwapAsset[] = ['XLM'];
    for (const balance of balances ?? []) {
      if (balance.asset_type !== 'native' && balance.asset_code && balance.asset_issuer) {
        options.push({ code: balance.asset_code, issuer: balance.asset_issuer });
      }
    }
    return options;
  }, [balances]);

  const slippageBps = Math.round(Number(slippagePercent) * 100);
  const slippageError =
    slippagePercent.length > 0 &&
    (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS)
      ? `Enter a slippage between 0 and ${MAX_SLIPPAGE_BPS / 100}%.`
      : null;
  const amountError =
    amount.length > 0 && !isValidAmount(amount)
      ? 'Enter an amount greater than 0 (up to 7 decimals).'
      : null;
  const pairError =
    destinationKey && sourceKey === destinationKey
      ? 'Choose two different assets.'
      : null;

  const busy = state === 'searching' || state === 'submitting';
  const canSearch =
    connected &&
    !!publicKey &&
    !!destinationKey &&
    amount.length > 0 &&
    !amountError &&
    !pairError &&
    !slippageError &&
    !busy;
  const canSwap = canSearch && state === 'quoted' && !!quote && !!signTransaction;

  const resetQuote = () => {
    setQuote(null);
    if (state === 'quoted' || state === 'error' || state === 'success') setState('idle');
    setMessage(null);
  };

  const handleFindRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch) return;

    setState('searching');
    setMessage(null);
    setQuote(null);
    try {
      const best = await findBestPath({
        mode,
        sourceAsset: keyToAsset(sourceKey),
        destinationAsset: keyToAsset(destinationKey),
        amount,
      });
      if (!best) {
        setState('error');
        setMessage('No route found for this pair and amount.');
        return;
      }
      setQuote(best);
      setState('quoted');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Failed to find a route.');
    }
  };

  const handleSwap = async () => {
    if (!canSwap || !quote || !publicKey || !signTransaction) return;

    setState('submitting');
    setMessage(null);
    try {
      const unsignedXdr = await buildPathPaymentXDR({
        mode,
        from: publicKey,
        quote,
        slippageBps,
      });
      const signedXdr = await signTransaction(unsignedXdr);
      const result = await submitSignedXDR(signedXdr);
      if (!result.success) {
        setState('error');
        setMessage(result.error ?? 'Swap failed.');
        return;
      }
      setState('success');
      setMessage(result.txHash ? `Swap submitted: ${result.txHash}` : 'Swap submitted.');
      setQuote(null);
      setAmount('');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Swap failed.');
    }
  };

  const inputClass =
    'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
  const labelClass = 'mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300';

  return (
    <form
      onSubmit={handleFindRoute}
      className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Swap</h3>
        {(state === 'submitting' || state === 'success' || state === 'error') && (
          <TransactionStatusBadge
            status={state === 'submitting' ? 'pending' : state === 'success' ? 'success' : 'failed'}
            label={state === 'submitting' ? 'Submitting' : state === 'success' ? 'Swapped' : 'Failed'}
          />
        )}
      </div>

      <div role="radiogroup" aria-label="Swap mode" className="flex gap-2 text-xs">
        {(['strict-send', 'strict-receive'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={busy}
            onClick={() => {
              setMode(value);
              resetQuote();
            }}
            className={`flex-1 rounded-md border px-2 py-1 ${
              mode === value
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300'
            }`}
          >
            {value === 'strict-send' ? 'Exact amount to send' : 'Exact amount to receive'}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="swap-form-source" className={labelClass}>
          From
        </label>
        <select
          id="swap-form-source"
          value={sourceKey}
          onChange={(e) => {
            setSourceKey(e.target.value);
            resetQuote();
          }}
          disabled={!connected || busy}
          className={inputClass}
        >
          {assetOptions.map((asset) => (
            <option key={assetKey(asset)} value={assetKey(asset)}>
              {assetLabel(asset)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="swap-form-destination" className={labelClass}>
          To
        </label>
        <select
          id="swap-form-destination"
          value={destinationKey}
          onChange={(e) => {
            setDestinationKey(e.target.value);
            resetQuote();
          }}
          disabled={!connected || busy}
          aria-invalid={!!pairError}
          aria-describedby={pairError ? 'swap-form-pair-error' : undefined}
          className={inputClass}
        >
          <option value="">Select an asset</option>
          {assetOptions.map((asset) => (
            <option key={assetKey(asset)} value={assetKey(asset)}>
              {assetLabel(asset)}
            </option>
          ))}
        </select>
        {pairError && (
          <p id="swap-form-pair-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {pairError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="swap-form-amount" className={labelClass}>
          {mode === 'strict-send' ? 'Amount to send' : 'Amount to receive'}
        </label>
        <input
          id="swap-form-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            resetQuote();
          }}
          placeholder="0.00"
          disabled={!connected || busy}
          aria-invalid={!!amountError}
          aria-describedby={amountError ? 'swap-form-amount-error' : undefined}
          className={inputClass}
        />
        {amountError && (
          <p id="swap-form-amount-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {amountError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="swap-form-slippage" className={labelClass}>
          Slippage tolerance (%)
        </label>
        <input
          id="swap-form-slippage"
          type="text"
          inputMode="decimal"
          value={slippagePercent}
          onChange={(e) => setSlippagePercent(e.target.value)}
          disabled={!connected || busy}
          aria-invalid={!!slippageError}
          aria-describedby={slippageError ? 'swap-form-slippage-error' : undefined}
          className={inputClass}
        />
        {slippageError && (
          <p id="swap-form-slippage-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {slippageError}
          </p>
        )}
      </div>

      {quote && (
        <dl
          aria-label="Swap route"
          className="space-y-1 rounded-md bg-gray-50 p-3 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <div className="flex justify-between gap-2">
            <dt>Route</dt>
            <dd data-testid="swap-route">{describePath(quote)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{mode === 'strict-send' ? 'You send' : 'You send (estimated)'}</dt>
            <dd>
              {quote.sourceAmount} {assetLabel(quote.sourceAsset)}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{mode === 'strict-send' ? 'You receive (estimated)' : 'You receive'}</dt>
            <dd>
              {quote.destinationAmount} {assetLabel(quote.destinationAsset)}
            </dd>
          </div>
          <div className="flex justify-between gap-2 font-medium">
            <dt>{mode === 'strict-send' ? 'Minimum received' : 'Maximum sent'}</dt>
            <dd data-testid="swap-bound">
              {mode === 'strict-send'
                ? `${minReceiveAmount(quote.destinationAmount, slippageBps)} ${assetLabel(quote.destinationAsset)}`
                : `${maxSendAmount(quote.sourceAmount, slippageBps)} ${assetLabel(quote.sourceAsset)}`}
            </dd>
          </div>
        </dl>
      )}

      {!connected && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Connect a wallet to swap.</p>
      )}
      {connected && !signTransaction && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The connected wallet adapter does not support signing swaps.
        </p>
      )}
      {message && (
        <p
          role={state === 'error' ? 'alert' : 'status'}
          className={`text-xs ${
            state === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSearch}
          className="flex-1 rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950"
        >
          {state === 'searching' ? 'Finding route…' : 'Find route'}
        </button>
        <button
          type="button"
          onClick={handleSwap}
          disabled={!canSwap}
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {state === 'submitting' ? 'Swapping…' : 'Swap'}
        </button>
      </div>
    </form>
  );
}
