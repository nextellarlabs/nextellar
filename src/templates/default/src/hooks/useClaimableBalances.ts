"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_FEE,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { useWallet, useWalletConfig } from "../contexts";

export type ClaimableBalancePredicate = {
  unconditional?: boolean;
  abs_before?: string;
  abs_before_epoch?: number | string;
  rel_before?: string;
  and?: ClaimableBalancePredicate[];
  or?: ClaimableBalancePredicate[];
  not?: ClaimableBalancePredicate;
};

export interface ClaimableBalanceClaimant {
  destination: string;
  predicate: ClaimableBalancePredicate;
  isClaimable: boolean;
}

export interface ClaimableBalance {
  id: string;
  asset: string;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "unknown";
  asset_code?: string;
  asset_issuer?: string;
  amount: string;
  sponsor?: string;
  last_modified_time?: string;
  claimants: ClaimableBalanceClaimant[];
  isClaimable: boolean;
}

export interface UseClaimableBalancesOptions {
  horizonUrl?: string;
  network?: "TESTNET" | "PUBLIC";
}

export interface ClaimableBalancesState {
  balances: ClaimableBalance[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  claimBalance: (
    balanceId: string,
  ) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
}

interface HorizonClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  sponsor?: string;
  last_modified_time?: string;
  claimants: Array<{
    destination: string;
    predicate: ClaimableBalancePredicate;
  }>;
}

const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

function parseTime(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseAsset(
  asset: string,
): Pick<ClaimableBalance, "asset_type" | "asset_code" | "asset_issuer"> {
  if (asset === "native") return { asset_type: "native" };

  const separator = asset.indexOf(":");
  if (separator <= 0 || separator === asset.length - 1) {
    return { asset_type: "unknown" };
  }

  const asset_code = asset.slice(0, separator);
  return {
    asset_type:
      asset_code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    asset_code,
    asset_issuer: asset.slice(separator + 1),
  };
}

function evaluatePredicate(
  predicate: ClaimableBalancePredicate,
  now: number,
  lastModifiedTime?: string,
): boolean {
  if (predicate.unconditional === true || Object.keys(predicate).length === 0) {
    return true;
  }

  if (predicate.abs_before_epoch !== undefined) {
    const deadline = parseTime(predicate.abs_before_epoch);
    return deadline !== undefined && now < deadline;
  }

  if (predicate.abs_before !== undefined) {
    const deadline = parseTime(predicate.abs_before);
    return deadline !== undefined && now < deadline;
  }

  if (predicate.rel_before !== undefined) {
    const modifiedAt = parseTime(lastModifiedTime);
    const duration = Number(predicate.rel_before);
    return (
      modifiedAt !== undefined &&
      Number.isFinite(duration) &&
      duration >= 0 &&
      now < modifiedAt + duration * 1000
    );
  }

  if (predicate.and) {
    return predicate.and.every((item) =>
      evaluatePredicate(item, now, lastModifiedTime),
    );
  }

  if (predicate.or) {
    return predicate.or.some((item) =>
      evaluatePredicate(item, now, lastModifiedTime),
    );
  }

  if (predicate.not) {
    return !evaluatePredicate(predicate.not, now, lastModifiedTime);
  }

  return false;
}

function parseClaimableBalance(
  balance: HorizonClaimableBalance,
  publicKey: string,
  now: number,
): ClaimableBalance {
  const claimants = balance.claimants.map((claimant) => ({
    destination: claimant.destination,
    predicate: claimant.predicate,
    isClaimable:
      claimant.destination === publicKey &&
      evaluatePredicate(claimant.predicate, now, balance.last_modified_time),
  }));

  return {
    id: balance.id,
    asset: balance.asset,
    ...parseAsset(balance.asset),
    amount: balance.amount,
    sponsor: balance.sponsor,
    last_modified_time: balance.last_modified_time,
    claimants,
    isClaimable: claimants.some((claimant) => claimant.isClaimable),
  };
}

export function useClaimableBalances(
  options: UseClaimableBalancesOptions = {},
): ClaimableBalancesState {
  const wallet = useWallet();
  const providerConfig = useWalletConfig();
  const horizonUrl =
    options.horizonUrl ?? providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL;
  const networkPassphrase =
    options.network === "PUBLIC"
      ? Networks.PUBLIC
      : options.network === "TESTNET"
        ? Networks.TESTNET
        : (providerConfig?.network ?? Networks.TESTNET);

  const [balances, setBalances] = useState<ClaimableBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef("");
  const isRequestInFlightRef = useRef(false);

  useEffect(() => {
    if (lastHorizonUrlRef.current !== horizonUrl) {
      try {
        serverRef.current = new Horizon.Server(horizonUrl);
        lastHorizonUrlRef.current = horizonUrl;
      } catch (err) {
        console.error("Failed to initialize Horizon server:", err);
        setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
      }
    }
  }, [horizonUrl]);

  const refresh = useCallback(async (): Promise<void> => {
    const publicKey = wallet.publicKey;
    if (!wallet.connected || !publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }

    if (!serverRef.current) {
      setError(new Error("Horizon server not initialized"));
      setLoading(false);
      return;
    }

    if (isRequestInFlightRef.current) return;

    if (typeof window === "undefined") {
      setError(new Error("Browser environment required"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    isRequestInFlightRef.current = true;

    try {
      const response = await serverRef.current
        .claimableBalances()
        .forClaimant(publicKey)
        .call();
      const now = Date.now();
      setBalances(
        response.records.map((balance) =>
          parseClaimableBalance(
            balance as HorizonClaimableBalance,
            publicKey,
            now,
          ),
        ),
      );
    } catch (err: unknown) {
      const errorObject: {
        message?: string;
        name?: string;
        response?: { status?: number };
      } =
        err && typeof err === "object"
          ? (err as {
              message?: string;
              name?: string;
              response?: { status?: number };
            })
          : {};
      if (
        errorObject.response?.status === 404 ||
        errorObject.name === "NotFoundError"
      ) {
        setBalances([]);
        setError(null);
      } else if (
        errorObject.response?.status &&
        errorObject.response.status >= 400 &&
        errorObject.response.status < 500
      ) {
        const clientError = new Error(
          `Client error: ${errorObject.message || "Invalid request to Horizon"} (Status: ${errorObject.response.status})`,
        );
        setError(clientError);
        console.error(
          "Error fetching Stellar claimable balances:",
          clientError,
        );
      } else {
        const fetchError =
          errorObject.message?.includes("fetch") ||
          (errorObject.response?.status && errorObject.response.status >= 500)
            ? new Error(
                `Network error: ${errorObject.message || "Failed to connect to Horizon"}`,
              )
            : err instanceof Error
              ? err
              : new Error("Failed to fetch claimable balances");
        setError(fetchError);
        console.error("Error fetching Stellar claimable balances:", fetchError);
      }
    } finally {
      setLoading(false);
      isRequestInFlightRef.current = false;
    }
  }, [wallet.connected, wallet.publicKey]);

  const claimBalance = useCallback(
    async (
      balanceId: string,
    ): Promise<Horizon.HorizonApi.SubmitTransactionResponse> => {
      if (!wallet.connected || !wallet.publicKey) {
        throw new Error("Wallet not connected");
      }
      if (!serverRef.current) {
        throw new Error("Horizon server not initialized");
      }

      const selectedBalance = balances.find(
        (balance) => balance.id === balanceId,
      );
      if (!selectedBalance) {
        throw new Error("Claimable balance not found");
      }
      const isCurrentlyClaimable = selectedBalance.claimants.some(
        (claimant) =>
          claimant.destination === wallet.publicKey &&
          evaluatePredicate(
            claimant.predicate,
            Date.now(),
            selectedBalance.last_modified_time,
          ),
      );
      if (!isCurrentlyClaimable) {
        throw new Error("Claimable balance is not currently claimable");
      }

      setError(null);
      try {
        const account = await serverRef.current.loadAccount(wallet.publicKey);
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(Operation.claimClaimableBalance({ balanceId }))
          .setTimeout(30)
          .build();

        const { signTransaction } = await import("../lib/stellar-wallet-kit");
        const signedXdr = await signTransaction({
          unsignedTransaction: transaction.toXDR(),
          address: wallet.publicKey,
        });
        const signedTransaction = TransactionBuilder.fromXDR(
          signedXdr,
          networkPassphrase,
        );
        const result =
          await serverRef.current.submitTransaction(signedTransaction);
        await refresh();
        return result;
      } catch (err) {
        const claimError =
          err instanceof Error ? err : new Error("Failed to claim balance");
        setError(claimError);
        console.error("Claimable balance submission failed:", claimError);
        throw claimError;
      }
    },
    [balances, networkPassphrase, refresh, wallet.connected, wallet.publicKey],
  );

  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }
    void refresh();
  }, [wallet.connected, wallet.publicKey, refresh]);

  return { balances, loading, error, refresh, claimBalance };
}
