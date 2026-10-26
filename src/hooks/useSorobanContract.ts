import { useState, useCallback } from "react";
import { Contract, xdr } from "@stellar/stellar-sdk";
import { useWallet } from "./useWallet";

interface UseSorobanContractOptions {
  contractId: string;
  rpcUrl?: string;
}

export function useSorobanContract({
  contractId,
  rpcUrl = "https://soroban-testnet.stellar.org",
}: UseSorobanContractOptions) {
  const { address } = useWallet();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const callContractMethod = useCallback(
    // `_args` is part of the public signature; the stub call doesn't use it yet.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (method: string, _args: xdr.ScVal[] = []) => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      setLoading(true);
      setError(null);

      try {
        // Throws on a malformed contract id before any network call.
        new Contract(contractId);
        // Build and invoke Soroban transaction flow
        const txResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getHealth",
          }),
        });

        const data = await txResponse.json();
        setLoading(false);
        return data;
      } catch (err: unknown) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
        throw err;
      }
    },
    [address, contractId, rpcUrl],
  );

  return {
    callContractMethod,
    loading,
    error,
    isWalletConnected: !!address,
  };
}
