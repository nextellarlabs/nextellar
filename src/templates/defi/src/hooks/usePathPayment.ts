'use client';

import { useCallback, useMemo } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Transaction,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { decodeResultCodes } from '../lib/stellarResultCodes';
import {
  DEFAULT_SLIPPAGE_BPS,
  maxSendAmount,
  minReceiveAmount,
  parsePathRecord,
  selectBestPath,
  toAsset,
  isValidAmount,
  type HorizonPathRecord,
  type PathQuote,
  type SwapAsset,
} from '../lib/pathPayment';

export type PathPaymentMode = 'strict-send' | 'strict-receive';

/**
 * Path-finding request. `amount` is what the sender spends in strict-send
 * mode and what the recipient gets in strict-receive mode.
 */
export type FindPathsParams = {
  mode: PathPaymentMode;
  sourceAsset: SwapAsset;
  destinationAsset: SwapAsset;
  amount: string;
};

export type PathPaymentParams = {
  mode: PathPaymentMode;
  from: string;
  /** Defaults to `from`, i.e. a swap within the same account. */
  to?: string;
  /** A quote returned by `findPaths`; the chosen route and estimate. */
  quote: PathQuote;
  /** Tolerated slippage in basis points (100 = 1%). Defaults to 1%. */
  slippageBps?: number;
};

export type PathPaymentResult = {
  success: boolean;
  txHash?: string;
  raw?: unknown;
  error?: string;
  resultCodes?: { transaction?: string; operations?: string[] };
};

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

/**
 * Hook for DEX swaps via Stellar path payments.
 *
 * 1. `findPaths` asks Horizon for routes between two assets.
 * 2. `buildPathPaymentXDR` builds an unsigned `pathPaymentStrictSend`
 *    (fixed spend, slippage sets `destMin`) or `pathPaymentStrictReceive`
 *    (fixed receive, slippage sets `sendMax`) transaction from a quote.
 * 3. `submitSignedXDR` submits the wallet-signed transaction.
 *
 * `signAndSubmitWithSecret` is DEVELOPMENT-ONLY; never handle secret keys in
 * production client code.
 */
export function usePathPayment(opts?: {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}): {
  findPaths: (params: FindPathsParams) => Promise<PathQuote[]>;
  findBestPath: (params: FindPathsParams) => Promise<PathQuote | null>;
  buildPathPaymentXDR: (params: PathPaymentParams) => Promise<string>;
  submitSignedXDR: (signedXdrBase64: string) => Promise<PathPaymentResult>;
  signAndSubmitWithSecret: (
    params: PathPaymentParams & { secret: string },
  ) => Promise<PathPaymentResult>;
} {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
  } = opts || {};

  const server = useMemo(() => new Horizon.Server(horizonUrl), [horizonUrl]);
  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  const findPaths = useCallback(
    async ({ mode, sourceAsset, destinationAsset, amount }: FindPathsParams): Promise<PathQuote[]> => {
      if (!isValidAmount(amount)) {
        throw new Error('Invalid amount: must be a positive number with at most 7 decimals');
      }

      try {
        const response =
          mode === 'strict-send'
            ? await server
                .strictSendPaths(toAsset(sourceAsset), amount, [toAsset(destinationAsset)])
                .call()
            : await server
                .strictReceivePaths([toAsset(sourceAsset)], toAsset(destinationAsset), amount)
                .call();

        return (response.records as unknown as HorizonPathRecord[]).map(parsePathRecord);
      } catch (err: unknown) {
        const errorObj = err as { response?: { status?: number }; message?: string };
        if (errorObj?.response?.status && errorObj.response.status >= 500) {
          throw new Error(`Horizon server error: ${errorObj.message || 'Network unavailable'}`);
        }
        throw err instanceof Error ? err : new Error('Failed to find payment paths');
      }
    },
    [server],
  );

  const findBestPath = useCallback(
    async (params: FindPathsParams): Promise<PathQuote | null> =>
      selectBestPath(await findPaths(params), params.mode),
    [findPaths],
  );

  const buildPathPaymentXDR = useCallback(
    async ({ mode, from, to, quote, slippageBps = DEFAULT_SLIPPAGE_BPS }: PathPaymentParams): Promise<string> => {
      const destination = to ?? from;
      const path = quote.path.map(toAsset);

      // Compute slippage bounds first so invalid input fails before any network call.
      const operation =
        mode === 'strict-send'
          ? Operation.pathPaymentStrictSend({
              sendAsset: toAsset(quote.sourceAsset),
              sendAmount: quote.sourceAmount,
              destination,
              destAsset: toAsset(quote.destinationAsset),
              destMin: minReceiveAmount(quote.destinationAmount, slippageBps),
              path,
            })
          : Operation.pathPaymentStrictReceive({
              sendAsset: toAsset(quote.sourceAsset),
              sendMax: maxSendAmount(quote.sourceAmount, slippageBps),
              destination,
              destAsset: toAsset(quote.destinationAsset),
              destAmount: quote.destinationAmount,
              path,
            });

      try {
        const account = await server.loadAccount(from);
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();
        return transaction.toXDR();
      } catch (err: unknown) {
        const errorObj = err as { response?: { status?: number }; message?: string };
        if (errorObj?.response?.status === 404) {
          throw new Error(`Account ${from} not found. Account may need funding.`);
        }
        if (errorObj?.response?.status && errorObj.response.status >= 500) {
          throw new Error(`Horizon server error: ${errorObj.message || 'Network unavailable'}`);
        }
        throw err instanceof Error ? err : new Error('Failed to build path payment transaction');
      }
    },
    [server, networkPassphrase],
  );

  const submitSignedXDR = useCallback(
    async (signedXdrBase64: string): Promise<PathPaymentResult> => {
      if (!signedXdrBase64 || typeof signedXdrBase64 !== 'string') {
        return { success: false, error: 'Invalid XDR: must be a non-empty string' };
      }

      try {
        const transaction = new Transaction(signedXdrBase64, networkPassphrase);
        const result = await server.submitTransaction(transaction);
        return { success: true, txHash: result.hash, raw: result };
      } catch (err: unknown) {
        const errorObj = err as {
          response?: {
            status?: number;
            data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
          };
          message?: string;
        };

        let error = 'Transaction failed';
        let resultCodes: PathPaymentResult['resultCodes'];
        const codes = errorObj?.response?.data?.extras?.result_codes;
        if (codes) {
          resultCodes = codes;
          error = decodeResultCodes(codes).reason;
        } else if (errorObj?.response?.status === 400) {
          error = 'Invalid transaction format or content';
        } else if (errorObj?.response?.status && errorObj.response.status >= 500) {
          error = 'Horizon server error during submission';
        } else if (errorObj?.message) {
          error = errorObj.message;
        }

        return { success: false, error, raw: errorObj?.response?.data, resultCodes };
      }
    },
    [server, networkPassphrase],
  );

  const signAndSubmitWithSecret = useCallback(
    async (params: PathPaymentParams & { secret: string }): Promise<PathPaymentResult> => {
      try {
        const keypair = Keypair.fromSecret(params.secret);
        if (keypair.publicKey() !== params.from) {
          return { success: false, error: 'Secret key does not match sender address' };
        }

        const unsignedXdr = await buildPathPaymentXDR(params);
        const transaction = new Transaction(unsignedXdr, networkPassphrase);
        transaction.sign(keypair);
        return await submitSignedXDR(transaction.toXDR());
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Sign and submit operation failed',
        };
      }
    },
    [buildPathPaymentXDR, submitSignedXDR, networkPassphrase],
  );

  return {
    findPaths,
    findBestPath,
    buildPathPaymentXDR,
    submitSignedXDR,
    signAndSubmitWithSecret,
  };
}
