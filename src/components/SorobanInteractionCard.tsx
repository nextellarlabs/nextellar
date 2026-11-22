import React, { useState } from 'react';
import { useSorobanContract } from '../hooks/useSorobanContract';

interface SorobanInteractionCardProps {
  contractId: string;
  title?: string;
}

export const SorobanInteractionCard: React.FC<SorobanInteractionCardProps> = ({
  contractId,
  title = 'Soroban Contract Portal',
}) => {
  const [methodName, setMethodName] = useState<string>('');
  const [result, setResult] = useState<string | null>(null);

  const { callContractMethod, loading, error, isWalletConnected } = useSorobanContract({
    contractId,
  });

  const handleInvoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!methodName) return;

    try {
      const res = await callContractMethod(methodName, []);
      setResult(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('Contract invocation failed:', err);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md border border-gray-100 space-y-4">
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 font-mono break-all">ID: {contractId}</p>

      {!isWalletConnected ? (
        <div className="p-3 bg-amber-50 text-amber-700 text-sm rounded-md">
          Please connect your Stellar wallet to interact with this contract.
        </div>
      ) : (
        <form onSubmit={handleInvoke} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Contract Method</label>
            <input
              type="text"
              value={methodName}
              onChange={(e) => setMethodName(e.target.value)}
              placeholder="e.g., increment"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !methodName}
            className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Invoking...' : 'Execute Method'}
          </button>
        </form>
      )}

      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-sm rounded-md">
          {error.message}
        </div>
      )}

      {result && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Execution Output</label>
          <pre className="p-3 bg-gray-900 text-green-400 text-xs rounded-md overflow-x-auto">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
};
