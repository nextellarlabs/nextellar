'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  Asset,
  BASE_FEE,
  Transaction,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { decodeResultCodes } from '../lib/stellarResultCodes';

/**
 * Stellar issuer account authorization flags supported by `setOptions`.
 */
export type IssuerAuthFlag =
  | 'AUTH_REQUIRED'
  | 'AUTH_REVOCABLE'
  | 'AUTH_IMMUTABLE'
  | 'AUTH_CLAWBACK_ENABLED';

/**
 * Bitmask values for Stellar account authorization flags.
 */
export const ISSUER_AUTH_FLAG_VALUES: Record<IssuerAuthFlag, number> = {
  AUTH_REQUIRED: 1,
  AUTH_REVOCABLE: 2,
  AUTH_IMMUTABLE: 4,
  AUTH_CLAWBACK_ENABLED: 8,
};

/**
 * Flags that permanently alter account behavior and cannot be reversed once set.
 */
export const IRREVERSIBLE_ISSUER_FLAGS: ReadonlySet<IssuerAuthFlag> = new Set([
  'AUTH_IMMUTABLE',
]);

/**
 * Options for the `useAssetIssuerTools` hook.
 */
export interface UseAssetIssuerToolsOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

/**
 * Parameters for updating issuer account authorization flags via `setOptions`.
 */
export interface SetFlagsParams {
  setFlags?: IssuerAuthFlag[];
  clearFlags?: IssuerAuthFlag[];
  /**
   * Must be explicitly set to `true` when setting an irreversible flag
   * (e.g. `AUTH_IMMUTABLE`). Without it, the hook refuses to build the transaction.
   */
  confirmIrreversible?: boolean;
  fee?: number | string;
}

/**
 * Parameters for clawing back an issued asset balance from a holder account.
 */
export interface ClawbackParams {
  assetCode: string;
  from: string;
  amount: string;
  fee?: number | string;
}

/**
 * Trustline flag toggles supported by `Operation.setTrustLineFlags`.
 * Each boolean sets (`true`) or clears (`false`) the corresponding flag;
 * omitted properties are left unchanged.
 */
export interface TrustLineFlagUpdates {
  authorized?: boolean;
  authorizedToMaintainLiabilities?: boolean;
  clawbackEnabled?: boolean;
}

/**
 * Parameters for updating authorization flags on a holder's trustline.
 */
export interface SetTrustLineFlagsParams {
  trustor: string;
  assetCode: string;
  flags: TrustLineFlagUpdates;
  fee?: number | string;
}

/**
 * Result returned by transaction submission helpers.
 */
export interface IssuerOperationResult {
  success: boolean;
  txHash?: string;
  raw?: unknown;
  error?: string;
  resultCodes?: { transaction?: string; operations?: string[] };
}

/**
 * Return value of the `useAssetIssuerTools` hook.
 */
export interface AssetIssuerToolsState {
  loading: boolean;
  error: Error | null;
  clearError: () => void;
  buildSetFlagsXDR: (params: SetFlagsParams) => Promise<string>;
  buildClawbackXDR: (params: ClawbackParams) => Promise<string>;
  buildSetTrustLineFlagsXDR: (params: SetTrustLineFlagsParams) => Promise<string>;
  submitSignedXDR: (signedXdrBase64: string) => Promise<IssuerOperationResult>;
  submitWithSecret: (xdr: string, secret: string) => Promise<IssuerOperationResult>;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

/**
 * Custom React hook for Stellar asset issuer operations.
 *
 * Wraps `Operation.setOptions` (authorization flags), `Operation.clawback`,
 * and `Operation.setTrustLineFlags` using the same loading, error, and
 * network-passphrase conventions as sibling hooks (`useTrustlines`, `useStellarPayment`).
 *
 * Refuses irreversible flag changes (such as `AUTH_IMMUTABLE`) unless
 * `confirmIrreversible: true` is explicitly passed.
 *
 * @param issuerPublicKey - Public key of the asset issuer account
 * @param options - Optional Horizon URL and network (`'TESTNET' | 'PUBLIC'`)
 */
export function useAssetIssuerTools(
  issuerPublicKey?: string | null,
  options: UseAssetIssuerToolsOptions = {},
): AssetIssuerToolsState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
  } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');

  useEffect(() => {
    if (lastHorizonUrlRef.current !== horizonUrl) {
      try {
        serverRef.current = new Horizon.Server(horizonUrl);
        lastHorizonUrlRef.current = horizonUrl;
      } catch (err) {
        console.error('Failed to initialize Horizon server:', err);
        setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
      }
    }
  }, [horizonUrl]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const getNetworkPassphrase = useCallback((): string => {
    return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  }, [network]);

  const isValidPublicKey = useCallback((key: string): boolean => {
    return key.length === 56 && key.startsWith('G');
  }, []);

  const isValidSecret = useCallback((secret: string): boolean => {
    return secret.length === 56 && secret.startsWith('S');
  }, []);

  const isValidAssetCode = useCallback((code: string): boolean => {
    return /^[A-Z0-9]{1,12}$/i.test(code);
  }, []);

  const isValidAmount = useCallback((amount: string): boolean => {
    const parsed = parseFloat(amount);
    return !isNaN(parsed) && parsed > 0 && parsed <= 922337203685.4775807;
  }, []);

  const formatHorizonBuildError = useCallback((err: unknown, fallbackMessage: string): Error => {
    const errorObj = err as { response?: { status?: number }; message?: string };
    if (errorObj?.response?.status === 404) {
      return new Error(`Issuer account ${issuerPublicKey} not found. Account may need funding.`);
    }
    if (errorObj?.response?.status && errorObj.response.status >= 500) {
      return new Error(`Horizon server error: ${errorObj.message || 'Network unavailable'}`);
    }
    if (errorObj?.response?.status && errorObj.response.status >= 400) {
      return new Error(`Invalid request: ${errorObj.message || 'Bad request to Horizon'}`);
    }
    return err instanceof Error ? err : new Error(fallbackMessage);
  }, [issuerPublicKey]);

  const requireIssuerAndServer = useCallback((): { server: Horizon.Server; issuer: string } => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }
    if (!issuerPublicKey) {
      throw new Error('Issuer public key is required');
    }
    if (!isValidPublicKey(issuerPublicKey)) {
      throw new Error('Invalid issuer public key format');
    }
    return { server: serverRef.current, issuer: issuerPublicKey };
  }, [issuerPublicKey, isValidPublicKey]);

  /**
   * Build an unsigned `setOptions` transaction XDR to set and/or clear
   * issuer authorization flags.
   *
   * Refuses irreversible flags (e.g. `AUTH_IMMUTABLE`) unless
   * `params.confirmIrreversible === true`.
   */
  const buildSetFlagsXDR = useCallback(
    async (params: SetFlagsParams): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        const { server, issuer } = requireIssuerAndServer();

        const setList = params.setFlags ?? [];
        const clearList = params.clearFlags ?? [];

        if (setList.length === 0 && clearList.length === 0) {
          throw new Error('At least one flag must be provided in setFlags or clearFlags');
        }

        const setSet = new Set<IssuerAuthFlag>();
        for (const flag of setList) {
          if (!(flag in ISSUER_AUTH_FLAG_VALUES)) {
            throw new Error(`Unknown issuer flag: ${String(flag)}`);
          }
          setSet.add(flag);
        }

        for (const flag of clearList) {
          if (!(flag in ISSUER_AUTH_FLAG_VALUES)) {
            throw new Error(`Unknown issuer flag: ${String(flag)}`);
          }
          if (setSet.has(flag)) {
            throw new Error(`Flag ${flag} cannot be both set and cleared in the same operation`);
          }
        }

        const irreversibleRequested = setList.filter((flag) =>
          IRREVERSIBLE_ISSUER_FLAGS.has(flag),
        );
        if (irreversibleRequested.length > 0 && params.confirmIrreversible !== true) {
          throw new Error(
            `Setting ${irreversibleRequested.join(', ')} is irreversible and permanently locks account flags. Pass confirmIrreversible: true to proceed.`,
          );
        }

        const setFlagsMask = setList.reduce(
          (mask, flag) => mask | ISSUER_AUTH_FLAG_VALUES[flag],
          0,
        );
        const clearFlagsMask = clearList.reduce(
          (mask, flag) => mask | ISSUER_AUTH_FLAG_VALUES[flag],
          0,
        );

        const account = await server.loadAccount(issuer);
        const txBuilder = new TransactionBuilder(account, {
          fee: String(params.fee ?? BASE_FEE),
          networkPassphrase: getNetworkPassphrase(),
        });

        txBuilder.addOperation(
          Operation.setOptions({
            ...(setFlagsMask > 0 ? { setFlags: setFlagsMask } : {}),
            ...(clearFlagsMask > 0 ? { clearFlags: clearFlagsMask } : {}),
          }),
        );
        txBuilder.setTimeout(30);

        return txBuilder.build().toXDR();
      } catch (err: unknown) {
        const formatted = formatHorizonBuildError(err, 'Failed to build setOptions transaction');
        setError(formatted);
        throw formatted;
      } finally {
        setLoading(false);
      }
    },
    [requireIssuerAndServer, getNetworkPassphrase, formatHorizonBuildError],
  );

  /**
   * Build an unsigned `clawback` transaction XDR to reclaim an issued asset
   * balance from a holder account.
   */
  const buildClawbackXDR = useCallback(
    async (params: ClawbackParams): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        const { server, issuer } = requireIssuerAndServer();

        if (!isValidAssetCode(params.assetCode)) {
          throw new Error('Invalid asset code: must be 1-12 alphanumeric characters');
        }
        if (!params.from || !isValidPublicKey(params.from)) {
          throw new Error('Invalid holder address format');
        }
        if (params.from === issuer) {
          throw new Error('Cannot clawback from the issuer account itself');
        }
        if (!isValidAmount(params.amount)) {
          throw new Error('Invalid amount: must be a positive number within Stellar limits');
        }

        const account = await server.loadAccount(issuer);
        const asset = new Asset(params.assetCode, issuer);

        const txBuilder = new TransactionBuilder(account, {
          fee: String(params.fee ?? BASE_FEE),
          networkPassphrase: getNetworkPassphrase(),
        });

        txBuilder.addOperation(
          Operation.clawback({
            asset,
            from: params.from,
            amount: params.amount,
          }),
        );
        txBuilder.setTimeout(30);

        return txBuilder.build().toXDR();
      } catch (err: unknown) {
        const formatted = formatHorizonBuildError(err, 'Failed to build clawback transaction');
        setError(formatted);
        throw formatted;
      } finally {
        setLoading(false);
      }
    },
    [
      requireIssuerAndServer,
      isValidAssetCode,
      isValidPublicKey,
      isValidAmount,
      getNetworkPassphrase,
      formatHorizonBuildError,
    ],
  );

  /**
   * Build an unsigned `setTrustLineFlags` transaction XDR to authorize,
   * revoke, or update clawback flags on a holder's trustline.
   */
  const buildSetTrustLineFlagsXDR = useCallback(
    async (params: SetTrustLineFlagsParams): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        const { server, issuer } = requireIssuerAndServer();

        if (!params.trustor || !isValidPublicKey(params.trustor)) {
          throw new Error('Invalid trustor public key format');
        }
        if (!isValidAssetCode(params.assetCode)) {
          throw new Error('Invalid asset code: must be 1-12 alphanumeric characters');
        }

        const { authorized, authorizedToMaintainLiabilities, clawbackEnabled } = params.flags ?? {};
        if (
          authorized === undefined &&
          authorizedToMaintainLiabilities === undefined &&
          clawbackEnabled === undefined
        ) {
          throw new Error('At least one trustline flag update must be specified');
        }

        const account = await server.loadAccount(issuer);
        const asset = new Asset(params.assetCode, issuer);

        const txBuilder = new TransactionBuilder(account, {
          fee: String(params.fee ?? BASE_FEE),
          networkPassphrase: getNetworkPassphrase(),
        });

        txBuilder.addOperation(
          Operation.setTrustLineFlags({
            trustor: params.trustor,
            asset,
            flags: {
              ...(authorized !== undefined ? { authorized } : {}),
              ...(authorizedToMaintainLiabilities !== undefined
                ? { authorizedToMaintainLiabilities }
                : {}),
              ...(clawbackEnabled !== undefined ? { clawbackEnabled } : {}),
            },
          }),
        );
        txBuilder.setTimeout(30);

        return txBuilder.build().toXDR();
      } catch (err: unknown) {
        const formatted = formatHorizonBuildError(
          err,
          'Failed to build setTrustLineFlags transaction',
        );
        setError(formatted);
        throw formatted;
      } finally {
        setLoading(false);
      }
    },
    [
      requireIssuerAndServer,
      isValidPublicKey,
      isValidAssetCode,
      getNetworkPassphrase,
      formatHorizonBuildError,
    ],
  );

  /**
   * Submit a signed transaction XDR to Horizon.
   */
  const submitSignedXDR = useCallback(
    async (signedXdrBase64: string): Promise<IssuerOperationResult> => {
      setLoading(true);
      setError(null);

      try {
        if (!serverRef.current) {
          throw new Error('Horizon server not initialized');
        }

        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
        if (
          !signedXdrBase64 ||
          typeof signedXdrBase64 !== 'string' ||
          signedXdrBase64.length <= 50 ||
          !base64Regex.test(signedXdrBase64)
        ) {
          throw new Error(
            'Invalid signed transaction XDR. The wallet may have returned a corrupted response.',
          );
        }

        const transaction = new Transaction(signedXdrBase64, getNetworkPassphrase());
        const result = await serverRef.current.submitTransaction(transaction);

        return {
          success: true,
          txHash: result.hash,
          raw: result,
        };
      } catch (err: unknown) {
        const errorObj = err as {
          response?: {
            status?: number;
            data?: {
              extras?: { result_codes?: { transaction?: string; operations?: string[] } };
            };
          };
          message?: string;
        };

        let errorMessage = 'Issuer transaction failed';
        let resultCodes: IssuerOperationResult['resultCodes'];

        if (errorObj?.response?.data?.extras?.result_codes) {
          const codes = errorObj.response.data.extras.result_codes;
          resultCodes = codes;
          errorMessage = decodeResultCodes(codes).reason;
        } else if (errorObj?.response?.status === 400) {
          errorMessage = 'Invalid transaction format or content';
        } else if (errorObj?.response?.status && errorObj.response.status >= 500) {
          errorMessage = 'Horizon server error during submission';
        } else if (errorObj?.message) {
          errorMessage = errorObj.message;
        }

        setError(new Error(errorMessage));

        return {
          success: false,
          error: errorMessage,
          raw: errorObj?.response?.data,
          resultCodes,
        };
      } finally {
        setLoading(false);
      }
    },
    [getNetworkPassphrase],
  );

  /**
   * **DEVELOPMENT-ONLY**: Sign an unsigned XDR with a secret key and submit to Horizon.
   *
   * Never use this in production applications; pass unsigned XDRs to an external
   * wallet for signing and submit with `submitSignedXDR`.
   */
  const submitWithSecret = useCallback(
    async (xdr: string, secret: string): Promise<IssuerOperationResult> => {
      if (!secret || !isValidSecret(secret)) {
        const err = new Error('Invalid secret key format');
        setError(err);
        return { success: false, error: err.message };
      }

      try {
        const keypair = Keypair.fromSecret(secret);
        if (issuerPublicKey && keypair.publicKey() !== issuerPublicKey) {
          const err = new Error('Secret key does not match the issuer public key');
          setError(err);
          return { success: false, error: err.message };
        }

        const transaction = new Transaction(xdr, getNetworkPassphrase());
        transaction.sign(keypair);

        return await submitSignedXDR(transaction.toXDR());
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Sign and submit operation failed';
        setError(new Error(message));
        return { success: false, error: message };
      }
    },
    [isValidSecret, issuerPublicKey, getNetworkPassphrase, submitSignedXDR],
  );

  return {
    loading,
    error,
    clearError,
    buildSetFlagsXDR,
    buildClawbackXDR,
    buildSetTrustLineFlagsXDR,
    submitSignedXDR,
    submitWithSecret,
  };
}
