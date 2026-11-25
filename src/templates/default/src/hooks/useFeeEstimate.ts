'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, BASE_FEE } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export type FeePresetName = 'low' | 'standard' | 'high';

export interface FeePresets {
  low: string;
  standard: string;
  high: string;
}

export interface UseFeeEstimateOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
  refreshInterval?: number; // In milliseconds, 0 to disable auto-refresh
  lowPercentile?: 'p10' | 'p20' | 'p30' | 'min';
  standardPercentile?: 'p40' | 'p50' | 'p60' | 'p70' | 'mode';
  highPercentile?: 'p80' | 'p90' | 'p95' | 'p99' | 'max';
}

export interface FeeEstimateState {
  loading: boolean;
  error: Error | null;
  baseFee: string;
  presets: FeePresets;
  rawStats: any | null;
  refresh: () => Promise<void>;
  getFeeForPreset: (preset: FeePresetName) => string;
  stroopsToXlm: (stroops: string | number) => string;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
const DEFAULT_REFRESH_INTERVAL = 30000;

export function stroopsToXlm(stroops: string | number): string {
  const numeric = typeof stroops === 'string' ? Number(stroops) : stroops;
  if (isNaN(numeric) || numeric < 0) return '0.0000100';
  return (numeric / 10_000_000).toFixed(7);
}

/**
 * Custom React hook for surge-aware fee estimation using Horizon fee_stats.
 *
 * Exposes low, standard, and high fee presets with configurable percentile selection,
 * automatic interval refreshes, and automatic fallback to BASE_FEE on error.
 */
export function useFeeEstimate(
  options: UseFeeEstimateOptions = {}
): FeeEstimateState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    refreshInterval = DEFAULT_REFRESH_INTERVAL,
    lowPercentile = 'p20',
    standardPercentile = 'p50',
    highPercentile = 'p95',
  } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [rawStats, setRawStats] = useState<any | null>(null);
  const [baseFee, setBaseFee] = useState<string>(BASE_FEE);
  const [presets, setPresets] = useState<FeePresets>({
    low: BASE_FEE,
    standard: BASE_FEE,
    high: BASE_FEE,
  });

  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');

  useEffect(() => {
    if (lastHorizonUrlRef.current !== horizonUrl) {
      try {
        serverRef.current = new Horizon.Server(horizonUrl);
        lastHorizonUrlRef.current = horizonUrl;
      } catch (err: any) {
        setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
      }
    }
  }, [horizonUrl]);

  const refresh = useCallback(async () => {
    if (!serverRef.current) {
      serverRef.current = new Horizon.Server(horizonUrl);
      lastHorizonUrlRef.current = horizonUrl;
    }

    setLoading(true);
    setError(null);

    try {
      const stats = await serverRef.current.feeStats();
      setRawStats(stats);

      const currentBaseFee = stats.last_ledger_base_fee || BASE_FEE;
      setBaseFee(currentBaseFee);

      const feeCharged = (stats as any).fee_charged || {};
      const maxFee = (stats as any).max_fee || {};

      const lowVal =
        feeCharged[lowPercentile] ||
        maxFee[lowPercentile] ||
        feeCharged.p20 ||
        feeCharged.min ||
        currentBaseFee;

      const standardVal =
        feeCharged[standardPercentile] ||
        maxFee[standardPercentile] ||
        feeCharged.p50 ||
        feeCharged.mode ||
        currentBaseFee;

      const highVal =
        feeCharged[highPercentile] ||
        maxFee[highPercentile] ||
        feeCharged.p95 ||
        feeCharged.max ||
        currentBaseFee;

      setPresets({
        low: String(lowVal),
        standard: String(standardVal),
        high: String(highVal),
      });
    } catch (err: any) {
      const errObj =
        err instanceof Error ? err : new Error(err?.message || 'Failed to fetch fee stats');
      setError(errObj);
      setBaseFee(BASE_FEE);
      setPresets({
        low: BASE_FEE,
        standard: BASE_FEE,
        high: BASE_FEE,
      });
    } finally {
      setLoading(false);
    }
  }, [horizonUrl, lowPercentile, standardPercentile, highPercentile]);

  useEffect(() => {
    refresh();

    if (refreshInterval > 0) {
      const timer = setInterval(() => {
        refresh();
      }, refreshInterval);
      return () => clearInterval(timer);
    }
  }, [refresh, refreshInterval]);

  const getFeeForPreset = useCallback(
    (preset: FeePresetName): string => {
      return presets[preset] || BASE_FEE;
    },
    [presets]
  );

  return {
    loading,
    error,
    baseFee,
    presets,
    rawStats,
    refresh,
    getFeeForPreset,
    stroopsToXlm,
  };
}

export default useFeeEstimate;
