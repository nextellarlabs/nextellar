import { useState, useEffect, useCallback } from "react";
import {
  isAllowed,
  setAllowed,
  getPublicKey,
  signTransaction,
} from "@stellar/freighter-api";

interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  error: string | null;
  isInstalling: boolean;
}

export function useWalletAuth() {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    publicKey: null,
    error: null,
    isInstalling: false,
  });

  const checkConnection = useCallback(async () => {
    try {
      const allowed = await isAllowed();
      if (allowed) {
        const pk = await getPublicKey();
        if (pk) {
          setState({
            isConnected: true,
            publicKey: pk,
            error: null,
            isInstalling: false,
          });
        }
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        error: err.message || "Failed to check wallet connection",
      }));
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = async () => {
    try {
      await setAllowed();
      const pk = await getPublicKey();
      if (pk) {
        setState({
          isConnected: true,
          publicKey: pk,
          error: null,
          isInstalling: false,
        });
      } else {
        setState((prev) => ({
          ...prev,
          error: "User denied wallet access or public key not found",
        }));
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        error: err.message || "Connection failed",
      }));
    }
  };

  const disconnect = () => {
    setState({
      isConnected: false,
      publicKey: null,
      error: null,
      isInstalling: false,
    });
  };

  return {
    ...state,
    connect,
    disconnect,
    recheck: checkConnection,
  };
}
