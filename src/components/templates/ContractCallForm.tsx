import React, { useState } from 'react';
import { Address, scValToNative } from '@stellar/stellar-sdk';

interface ContractCallFormProps {
  contractId: string;
  methodName: string;
  onSuccess?: (result: any) => void;
  onError?: (error: Error) => void;
}

export const ContractCallForm: React.FC<ContractCallFormProps> = ({
  contractId,
  methodName,
  onSuccess,
  onError,
}) => {
  const [argValue, setArgValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [txResult, setTxResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // Invoke contract method flow via wallet connector or rpc client
      console.log(`Invoking ${methodName} on contract ${contractId} with arg:`, argValue);
      
      // Simulated response mock for template verification
      const mockResult = { status: 'SUCCESS', hash: 'abc123mocktxhash' };
      setTxResult(mockResult);
      if (onSuccess) onSuccess(mockResult);
    } catch (err: any) {
      if (onError) onError(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-md border border-gray-200 dark:border-gray-800">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Call: <span className="font-mono text-indigo-600">{methodName}</span>
      </h3>
      <p className="text-xs font-mono text-gray-500 mb-4 truncate">Contract: {contractId}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Method Argument (Raw / Native Value)
          </label>
          <input
            type="text"
            value={argValue}
            onChange={(e) => setArgValue(e.target.value)}
            placeholder="Enter argument value..."
            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition disabled:opacity-50"
        >
          {isLoading ? 'Submitting Transaction...' : 'Invoke Contract'}
        </button>
      </form>

      {txResult && (
        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          <p className="font-semibold">Transaction Executed Successfully!</p>
          <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(txResult, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
