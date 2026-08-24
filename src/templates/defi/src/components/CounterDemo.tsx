'use client';

import { useState, useEffect } from 'react';
import { useSorobanContract } from '@/hooks/useSorobanContract';
import { CounterClient, CONTRACTS } from '@/lib/contracts';

export default function CounterDemo() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const contract = useSorobanContract({
    contractId: CONTRACTS.COUNTER,
    network: 'TESTNET',
  });

  const client = new CounterClient(contract);

  // Initialize counter on mount
  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        await client.initialize({ initial_count: 0 });
        const currentCount = await client.getCount();
        setCount(currentCount);
        setInitialized(true);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize counter');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  // Fetch current count
  const fetchCount = async () => {
    try {
      setLoading(true);
      const currentCount = await client.getCount();
      setCount(currentCount);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch count');
    } finally {
      setLoading(false);
    }
  };

  const handleIncrement = async () => {
    try {
      setLoading(true);
      const newValue = await client.increment();
      setCount(newValue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to increment');
    } finally {
      setLoading(false);
    }
  };

  const handleDecrement = async () => {
    try {
      setLoading(true);
      const newValue = await client.decrement();
      setCount(newValue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decrement');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    try {
      setLoading(true);
      const newValue = await client.add({ amount: 10 });
      setCount(newValue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      setLoading(true);
      await client.reset();
      setCount(0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-indigo-950 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Counter Contract Demo
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
          Interact with a Soroban smart contract on Stellar
        </p>

        {/* Status */}
        {!initialized && (
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Initializing contract... Please make sure your contract ID is set in the environment.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Counter Display */}
        <div className="mb-8">
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg p-8 text-center">
            <p className="text-white/80 text-sm mb-2">Current Count</p>
            <p className="text-5xl font-bold text-white">
              {count !== null ? count : '—'}
            </p>
          </div>
        </div>

        {/* Button Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={handleDecrement}
            disabled={loading || count === null}
            className="px-4 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {loading ? '...' : '−'}
          </button>
          <button
            onClick={handleIncrement}
            disabled={loading || count === null}
            className="px-4 py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {loading ? '...' : '+'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={handleAdd}
            disabled={loading || count === null}
            className="px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed text-sm"
          >
            {loading ? '...' : '+10'}
          </button>
          <button
            onClick={handleReset}
            disabled={loading || count === null}
            className="px-4 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {loading ? '...' : 'Reset'}
          </button>
        </div>

        <button
          onClick={fetchCount}
          disabled={loading || count === null}
          className="w-full px-4 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
        >
          {loading ? 'Loading...' : 'Refresh Count'}
        </button>

        {/* Info */}
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            Contract ID:
          </p>
          <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all bg-gray-50 dark:bg-gray-900 p-2 rounded">
            {CONTRACTS.COUNTER}
          </p>
        </div>
      </div>
    </div>
  );
}
