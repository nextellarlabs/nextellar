'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '../contexts';
import { useStellarPayment } from '../hooks/useStellarPayment';
import { useTrustlines } from '../hooks/useTrustlines';
import { kit } from '../lib/stellar-wallet-kit';

interface SendFormProps {
  theme?: 'light' | 'dark';
}

type AssetOption =
  | { type: 'native'; code: 'XLM' }
  | { type: 'trusted'; code: string; issuer: string };

type StatusType = 'idle' | 'loading' | 'success' | 'error';

const STELLAR_ADDRESS_REGEX = /^G[A-Z0-9]{55}$/;
const MEMO_MAX_LENGTH = 28;

function isValidStellarAddress(addr: string): boolean {
  return STELLAR_ADDRESS_REGEX.test(addr);
}

function isValidAmount(amount: string, balance: string): boolean {
  const parsed = parseFloat(amount);
  const bal = parseFloat(balance);
  return !isNaN(parsed) && parsed > 0 && parsed <= bal;
}

function isValidMemo(memo: string): boolean {
  return memo.length <= MEMO_MAX_LENGTH;
}

export default function SendForm({ theme = 'light' }: SendFormProps) {
  const { connected, publicKey, balances, refreshBalances } = useWallet();
  const { trustlines } = useTrustlines(publicKey);
  const { buildPaymentXDR, submitSignedXDR } = useStellarPayment();

  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetOption>({
    type: 'native',
    code: 'XLM',
  });
  const [status, setStatus] = useState<StatusType>('idle');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    destination?: string;
    amount?: string;
    memo?: string;
  }>({});

  const nativeBalance = balances.find(
    (b) => b.asset_type === 'native'
  )?.balance ?? '0';

  const assetBalance = useCallback(
    (asset: AssetOption): string => {
      if (asset.type === 'native') return nativeBalance;
      const tl = balances.find(
        (b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer
      );
      return tl?.balance ?? '0';
    },
    [balances, nativeBalance]
  );

  const assetOptions: AssetOption[] = [
    { type: 'native', code: 'XLM' },
    ...trustlines.map((tl) => ({
      type: 'trusted' as const,
      code: tl.asset_code,
      issuer: tl.asset_issuer,
    })),
  ];

  const validateForm = useCallback((): boolean => {
    const errors: typeof fieldErrors = {};

    if (!destination.trim()) {
      errors.destination = 'Destination address is required';
    } else if (!isValidStellarAddress(destination.trim())) {
      errors.destination =
        'Invalid Stellar address (must start with G and be 56 characters)';
    } else if (destination.trim() === publicKey) {
      errors.destination = 'Cannot send to yourself';
    }

    if (!amount.trim()) {
      errors.amount = 'Amount is required';
    } else if (!isValidAmount(amount.trim(), assetBalance(selectedAsset))) {
      errors.amount =
        'Amount must be positive and cannot exceed your available balance';
    }

    if (memo.trim() && !isValidMemo(memo.trim())) {
      errors.memo = 'Memo cannot exceed 28 characters';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [destination, amount, memo, selectedAsset, publicKey, assetBalance]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!connected || !publicKey) {
        setStatus('error');
        setMessage('Wallet not connected');
        return;
      }

      if (!validateForm()) return;

      setStatus('loading');
      setMessage('');

      try {
        const assetParam =
          selectedAsset.type === 'native'
            ? ('XLM' as const)
            : { code: selectedAsset.code, issuer: selectedAsset.issuer };

        const xdr = await buildPaymentXDR({
          from: publicKey,
          to: destination.trim(),
          amount: amount.trim(),
          asset: assetParam,
          memo: memo.trim() || undefined,
        });

        const { signedTxXdr } = await kit().signTransaction(xdr, {
          address: publicKey,
        });

        const result = await submitSignedXDR(signedTxXdr);

        if (result.success) {
          setStatus('success');
          setMessage(
            `Payment sent successfully! Tx: ${result.txHash?.slice(0, 16)}...`
          );
          setDestination('');
          setAmount('');
          setMemo('');
          setSelectedAsset({ type: 'native', code: 'XLM' });
          refreshBalances();
        } else {
          setStatus('error');
          setMessage(result.error || 'Transaction failed');
        }
      } catch (err: unknown) {
        setStatus('error');
        setMessage(
          err instanceof Error ? err.message : 'Payment submission failed'
        );
      }
    },
    [
      connected,
      publicKey,
      validateForm,
      selectedAsset,
      destination,
      amount,
      memo,
      buildPaymentXDR,
      submitSignedXDR,
      refreshBalances,
    ]
  );

  const handleClear = useCallback(() => {
    setDestination('');
    setAmount('');
    setMemo('');
    setSelectedAsset({ type: 'native', code: 'XLM' });
    setFieldErrors({});
    setStatus('idle');
    setMessage('');
  }, []);

  if (!connected || !publicKey) {
    return (
      <div
        className={`p-6 rounded-xl text-center ${
          theme === 'light'
            ? 'bg-gray-50 border border-gray-200'
            : 'bg-white/5 border border-white/10'
        }`}
      >
        <p
          className={
            theme === 'light' ? 'text-gray-600' : 'text-gray-300'
          }
        >
          Connect your wallet to send payments
        </p>
      </div>
    );
  }

  const inputBase = `w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-colors ${
    theme === 'light'
      ? 'bg-white border-gray-300 text-black placeholder-gray-400 focus:border-black'
      : 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-white'
  }`;

  const inputError = `border-red-500 focus:border-red-500`;

  const labelClass = `block text-sm font-medium mb-1.5 ${
    theme === 'light' ? 'text-gray-700' : 'text-gray-200'
  }`;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Asset selector */}
      <div>
        <label className={labelClass}>Asset</label>
        <select
          value={
            selectedAsset.type === 'native'
              ? 'XLM'
              : `${selectedAsset.code}:${selectedAsset.issuer}`
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'XLM') {
              setSelectedAsset({ type: 'native', code: 'XLM' });
            } else {
              const [code, issuer] = val.split(':');
              setSelectedAsset({ type: 'trusted', code, issuer });
            }
            setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          className={inputBase}
        >
          {assetOptions.map((opt) => (
            <option
              key={
                opt.type === 'native'
                  ? 'XLM'
                  : `${opt.code}:${opt.issuer}`
              }
              value={
                opt.type === 'native'
                  ? 'XLM'
                  : `${opt.code}:${opt.issuer}`
              }
            >
              {opt.type === 'native'
                ? 'XLM (native)'
                : `${opt.code} (${opt.issuer.slice(0, 8)}...)`}
            </option>
          ))}
        </select>
        <p
          className={`text-xs mt-1 ${
            theme === 'light' ? 'text-gray-500' : 'text-gray-400'
          }`}
        >
          Balance:{' '}
          {parseFloat(assetBalance(selectedAsset)).toFixed(4)}{' '}
          {selectedAsset.code}
        </p>
      </div>

      {/* Destination */}
      <div>
        <label className={labelClass}>Destination</label>
        <input
          type="text"
          placeholder="G... (56 characters)"
          value={destination}
          onChange={(e) => {
            setDestination(e.target.value);
            setFieldErrors((prev) => ({
              ...prev,
              destination: undefined,
            }));
          }}
          className={`${inputBase} ${
            fieldErrors.destination ? inputError : ''
          }`}
        />
        {fieldErrors.destination && (
          <p className="text-red-500 text-xs mt-1">
            {fieldErrors.destination}
          </p>
        )}
      </div>

      {/* Amount */}
      <div>
        <label className={labelClass}>Amount</label>
        <input
          type="text"
          placeholder="0.0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          className={`${inputBase} ${
            fieldErrors.amount ? inputError : ''
          }`}
        />
        {fieldErrors.amount && (
          <p className="text-red-500 text-xs mt-1">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      {/* Memo (optional) */}
      <div>
        <label className={labelClass}>
          Memo{' '}
          <span
            className={
              theme === 'light' ? 'text-gray-400' : 'text-gray-500'
            }
          >
            (optional)
          </span>
        </label>
        <input
          type="text"
          placeholder="Max 28 characters"
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value);
            setFieldErrors((prev) => ({ ...prev, memo: undefined }));
          }}
          className={`${inputBase} ${
            fieldErrors.memo ? inputError : ''
          }`}
        />
        {fieldErrors.memo && (
          <p className="text-red-500 text-xs mt-1">
            {fieldErrors.memo}
          </p>
        )}
        <p
          className={`text-xs mt-1 text-right ${
            theme === 'light' ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          {memo.length}/{MEMO_MAX_LENGTH}
        </p>
      </div>

      {/* Status feedback */}
      {status === 'loading' && (
        <div
          className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
            theme === 'light'
              ? 'bg-blue-50 text-blue-700'
              : 'bg-blue-900/20 text-blue-300'
          }`}
        >
          <svg
            className="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Submitting payment...
        </div>
      )}

      {status === 'success' && (
        <div
          className={`text-sm p-3 rounded-lg ${
            theme === 'light'
              ? 'bg-green-50 text-green-700'
              : 'bg-green-900/20 text-green-300'
          }`}
        >
          {message}
        </div>
      )}

      {status === 'error' && (
        <div
          className={`text-sm p-3 rounded-lg ${
            theme === 'light'
              ? 'bg-red-50 text-red-700'
              : 'bg-red-900/20 text-red-300'
          }`}
        >
          {message}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={status === 'loading'}
          className={`flex-1 px-6 py-2.5 font-medium rounded-full transition-colors ${
            theme === 'light'
              ? 'bg-black text-white hover:bg-gray-800'
              : 'bg-white text-black hover:bg-gray-200'
          } ${
            status === 'loading' ? 'opacity-75 cursor-not-allowed' : ''
          }`}
        >
          {status === 'loading' ? 'Sending...' : 'Send Payment'}
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={status === 'loading'}
          className={`px-6 py-2.5 font-medium rounded-full border transition-colors ${
            theme === 'light'
              ? 'border-gray-300 text-gray-700 hover:bg-gray-100'
              : 'border-white/10 text-gray-300 hover:bg-white/5'
          } ${
            status === 'loading' ? 'opacity-75 cursor-not-allowed' : ''
          }`}
        >
          Clear
        </button>
      </div>
    </form>
  );
}