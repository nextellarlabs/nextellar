'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  Asset,
  Claimant,
  Memo,
  StrKey,
  BASE_FEE,
  Transaction,
  type xdr,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { decodeResultCodes } from '../lib/stellarResultCodes';

/**
 * Recursive claim predicate descriptor for Stellar claimable balances.
 */
export type ClaimPredicate =
  | { type: 'unconditional' }
  | { type: 'absBefore'; timestamp: number | string | Date }
  | { type: 'relBefore'; seconds: number | string }
  | { type: 'not'; predicate: ClaimPredicate }
  | { type: 'and'; left: ClaimPredicate; right: ClaimPredicate }
  | { type: 'or'; left: ClaimPredicate; right: ClaimPredicate };

/**
 * Claimant definition pairing a destination account with an optional predicate.
 * When `predicate` is omitted, `Claimant.predicateUnconditional()` is used.
 */
export interface ClaimantInput {
  destination: string;
  predicate?: ClaimPredicate;
}

/**
 * Asset specification: native XLM or an issued asset `{ code, issuer }`.
 */
export type ClaimableBalanceAsset = 'XLM' | { code: string; issuer: string };

/**
 * Parameters for creating a Stellar claimable balance transaction.
 */
export interface CreateClaimableBalanceParams {
  source: string;
  asset?: ClaimableBalanceAsset;
  amount: string;
  claimants: ClaimantInput[];
  memo?: string;
  fee?: number | string;
}

/**
 * Submission result for a claimable balance transaction.
 */
export interface CreateClaimableBalanceResult {
  success: boolean;
  txHash?: string;
  raw?: unknown;
  error?: string;
  resultCodes?: { transaction?: string; operations?: string[] };
}

/**
 * Options for the `useCreateClaimableBalance` hook.
 */
export interface UseCreateClaimableBalanceOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

/**
 * Return value of the `useCreateClaimableBalance` hook.
 */
export interface UseCreateClaimableBalanceReturn {
  loading: boolean;
  error: Error | null;
  buildCreateClaimableBalanceXDR: (params: CreateClaimableBalanceParams) => Promise<string>;
  submitSignedXDR: (signedXdrBase64: string) => Promise<CreateClaimableBalanceResult>;
  signAndSubmitWithSecret: (
    params: CreateClaimableBalanceParams & { secret: string },
  ) => Promise<CreateClaimableBalanceResult>;
  reset: () => void;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
const MAX_STELLAR_AMOUNT = 922337203685.4775807;
const MAX_CLAIMANTS = 10;
const AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;
const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
const NON_NEGATIVE_INT_REGEX = /^\d+$/;

function isValidPublicKey(address: string): boolean {
  return typeof address === 'string' && StrKey.isValidEd25519PublicKey(address);
}

function isValidSecret(secret: string): boolean {
  return typeof secret === 'string' && StrKey.isValidEd25519SecretSeed(secret);
}

function isValidAmount(amount: string): boolean {
  if (typeof amount !== 'string' || !AMOUNT_REGEX.test(amount)) {
    return false;
  }
  const parsed = Number(amount);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_STELLAR_AMOUNT;
}

function normalizeTimestamp(value: number | string | Date, label: string): string {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Invalid ${label}: must be a valid non-negative date`);
    }
    return Math.floor(ms / 1000).toString();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid ${label}: must be a non-negative integer`);
    }
    return value.toString();
  }
  if (typeof value === 'string' && NON_NEGATIVE_INT_REGEX.test(value.trim())) {
    return value.trim();
  }
  throw new Error(`Invalid ${label}: must be a non-negative integer`);
}

/**
 * Convert a `ClaimPredicate` descriptor into an SDK `xdr.ClaimPredicate`.
 */
export function buildClaimPredicate(predicate?: ClaimPredicate): xdr.ClaimPredicate {
  if (!predicate || predicate.type === 'unconditional') {
    return Claimant.predicateUnconditional();
  }

  switch (predicate.type) {
    case 'absBefore':
      return Claimant.predicateBeforeAbsoluteTime(
        normalizeTimestamp(predicate.timestamp, 'absBefore timestamp'),
      );
    case 'relBefore':
      return Claimant.predicateBeforeRelativeTime(
        normalizeTimestamp(predicate.seconds, 'relBefore seconds'),
      );
    case 'not':
      return Claimant.predicateNot(buildClaimPredicate(predicate.predicate));
    case 'and':
      return Claimant.predicateAnd(
        buildClaimPredicate(predicate.left),
        buildClaimPredicate(predicate.right),
      );
    case 'or':
      return Claimant.predicateOr(
        buildClaimPredicate(predicate.left),
        buildClaimPredicate(predicate.right),
      );
    default: {
      const exhaustive: never = predicate;
      throw new Error(`Unsupported predicate type: ${String(exhaustive)}`);
    }
  }
}

function validateParams(params: CreateClaimableBalanceParams): void {
  if (!isValidPublicKey(params.source)) {
    throw new Error('Invalid source address: must be a valid Stellar public key');
  }

  if (params.asset && params.asset !== 'XLM') {
    if (!ASSET_CODE_REGEX.test(params.asset.code)) {
      throw new Error('Invalid asset code: must be 1-12 alphanumeric characters');
    }
    if (!isValidPublicKey(params.asset.issuer)) {
      throw new Error('Invalid asset issuer: must be a valid Stellar public key');
    }
  }

  if (!isValidAmount(params.amount)) {
    throw new Error(
      'Invalid amount: must be a positive number with up to 7 decimal places within Stellar limits',
    );
  }

  if (!Array.isArray(params.claimants) || params.claimants.length === 0) {
    throw new Error('At least one claimant is required');
  }

  if (params.claimants.length > MAX_CLAIMANTS) {
    throw new Error(`Cannot specify more than ${MAX_CLAIMANTS} claimants`);
  }

  const seen = new Set<string>();
  for (let i = 0; i < params.claimants.length; i++) {
    const claimant = params.claimants[i];
    if (!isValidPublicKey(claimant.destination)) {
      throw new Error(`Invalid claimant address at index ${i}: must be a valid Stellar public key`);
    }
    if (seen.has(claimant.destination)) {
      throw new Error(`Duplicate claimant address: ${claimant.destination}`);
    }
    seen.add(claimant.destination);
    // Validate predicate structure eagerly before hitting Horizon
    buildClaimPredicate(claimant.predicate);
  }

  if (params.memo !== undefined && params.memo.length > 28) {
    throw new Error('Memo text cannot exceed 28 characters');
  }
}

/**
 * Custom React hook for building and submitting Stellar `createClaimableBalance` transactions.
 *
 * Supports multiple claimants and composable `unconditional`, `absBefore`, `relBefore`,
 * `not`, `and`, and `or` predicates. Validates asset, 7-decimal amount, and claimant
 * addresses before loading the source account or building the transaction.
 */
export function useCreateClaimableBalance(
  options: UseCreateClaimableBalanceOptions = {},
): UseCreateClaimableBalanceReturn {
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

  const getNetworkPassphrase = useCallback((): string => {
    return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  }, [network]);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  const buildCreateClaimableBalanceXDR = useCallback(
    async (params: CreateClaimableBalanceParams): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        if (!serverRef.current) {
          throw new Error('Horizon server not initialized');
        }

        validateParams(params);

        const account = await serverRef.current.loadAccount(params.source);

        const asset =
          !params.asset || params.asset === 'XLM'
            ? Asset.native()
            : new Asset(params.asset.code, params.asset.issuer);

        const claimants = params.claimants.map(
          (c) => new Claimant(c.destination, buildClaimPredicate(c.predicate)),
        );

        const txBuilder = new TransactionBuilder(account, {
          fee: String(params.fee ?? BASE_FEE),
          networkPassphrase: getNetworkPassphrase(),
        });

        txBuilder.addOperation(
          Operation.createClaimableBalance({
            asset,
            amount: params.amount,
            claimants,
          }),
        );

        if (params.memo) {
          txBuilder.addMemo(Memo.text(params.memo));
        }

        txBuilder.setTimeout(30);
        const transaction = txBuilder.build();
        return transaction.toXDR();
      } catch (err: unknown) {
        const errorObj = err as { response?: { status?: number }; message?: string };
        let normalized: Error;
        if (errorObj?.response?.status === 404) {
          normalized = new Error(`Account ${params.source} not found. Account may need funding.`);
        } else if (errorObj?.response?.status && errorObj.response.status >= 500) {
          normalized = new Error(
            `Horizon server error: ${errorObj.message || 'Network unavailable'}`,
          );
        } else if (errorObj?.response?.status && errorObj.response.status >= 400) {
          normalized = new Error(
            `Invalid request: ${errorObj.message || 'Bad request to Horizon'}`,
          );
        } else {
          normalized =
            err instanceof Error
              ? err
              : new Error('Failed to build createClaimableBalance transaction');
        }
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [getNetworkPassphrase],
  );

  const submitSignedXDR = useCallback(
    async (signedXdrBase64: string): Promise<CreateClaimableBalanceResult> => {
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
        console.error('Claimable balance submission failed:', err);

        let errorMessage = 'Transaction failed';
        let resultCodes: CreateClaimableBalanceResult['resultCodes'];
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

  const signAndSubmitWithSecret = useCallback(
    async (
      params: CreateClaimableBalanceParams & { secret: string },
    ): Promise<CreateClaimableBalanceResult> => {
      if (!params.secret || !isValidSecret(params.secret)) {
        const msg = 'Invalid secret key format';
        setError(new Error(msg));
        return { success: false, error: msg };
      }

      try {
        const keypair = Keypair.fromSecret(params.secret);
        if (keypair.publicKey() !== params.source) {
          const msg = 'Secret key does not match source address';
          setError(new Error(msg));
          return { success: false, error: msg };
        }

        const unsignedXdr = await buildCreateClaimableBalanceXDR(params);
        const transaction = new Transaction(unsignedXdr, getNetworkPassphrase());
        transaction.sign(keypair);

        return await submitSignedXDR(transaction.toXDR());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Sign and submit operation failed';
        setError(err instanceof Error ? err : new Error(msg));
        return { success: false, error: msg };
      }
    },
    [buildCreateClaimableBalanceXDR, submitSignedXDR, getNetworkPassphrase],
  );

  return {
    loading,
    error,
    buildCreateClaimableBalanceXDR,
    submitSignedXDR,
    signAndSubmitWithSecret,
    reset,
  };
}
