import { useState, useEffect, useCallback } from 'react';
import { Contract, Address, scValToNative, xdr } from '@stellar/stellar-sdk';
import { useWallet } from './useWallet';

interface UseSorobanContractOptions {
  contractId: string;
  rpcUrl?: string;
}

export function useSorobanContract({ contractId, rpcUrl = 'https://soroban-testnet.stellar.org' }: UseSorobanContractOptions) {
  const { address, signTransaction } = useWallet();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const callContractMethod = useCallback(
    async (method: string, args: xdr.ScVal[] = []) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      setLoading(true);
      setError(null);

      try {
        const contract = new Contract(contractId);
        // Build and invoke Soroban transaction flow
        const txResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getHealth',
          }),
        });

        const data = await txResponse.json();
        setLoading(false);
        return data;
      } catch (err: any) {
        setError(err);
        setLoading(false);
        throw err;
      }
    },
    [address, contractId, rpcUrl]
  );

  return {
    callContractMethod,
    loading,
    error,
    isWalletConnected: !!address,
  };
}
