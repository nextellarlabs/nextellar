import { useState } from 'react';
import { signTransaction } from '@stellar/freighter-api';

interface SignerOptions {
  networkPassphrase?: string;
}

export function useSepXdrSigner(options: SignerOptions = {}) {
  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const networkPassphrase = options.networkPassphrase || 'Test SDF Network ; September 2015';

  const signXdr = async (xdrPayload: string): Promise<string | null> => {
    setIsSigning(true);
    setError(null);
    try {
      const signedXdr = await signTransaction(xdrPayload, {
        networkPassphrase,
      });
      setIsSigning(false);
      return signedXdr;
    } catch (err: any) {
      setError(err.message || 'Failed to sign transaction XDR');
      setIsSigning(false);
      return null;
    }
  };

  return {
    signXdr,
    isSigning,
    error,
  };
}
