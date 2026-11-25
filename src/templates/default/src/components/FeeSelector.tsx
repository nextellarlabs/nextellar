'use client';

import React, { useContext, useId } from 'react';
import { I18nContext } from '../contexts/I18nProvider';
import { useFeeEstimate, type FeePresetName } from '../hooks/useFeeEstimate';
import { en } from '../locales/en';

export interface FeeSelectorProps {
  id?: string;
  selectedPreset: FeePresetName;
  onPresetChange: (preset: FeePresetName) => void;
  disabled?: boolean;
  className?: string;
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

const PRESETS: readonly FeePresetName[] = ['low', 'standard', 'high'];

export const FeeSelector: React.FC<FeeSelectorProps> = ({
  id,
  selectedPreset,
  onPresetChange,
  disabled = false,
  className = '',
  horizonUrl,
  network,
}) => {
  const generatedId = useId();
  const baseId = id || generatedId;

  const i18nContext = useContext(I18nContext);
  const t = i18nContext ? i18nContext.t : ((key: string, params?: Record<string, string | number>) => {
    const keys = key.split('.');
    let curr: any = en;
    for (const k of keys) {
      if (!curr) return key;
      curr = curr[k];
    }
    let res = typeof curr === 'string' ? curr : key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        res = res.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return res;
  });

  const { presets, loading, stroopsToXlm } = useFeeEstimate({
    horizonUrl,
    network,
  });

  const groupLabel = t('fee.selector');
  const mainLabel = t('fee.label');

  const presetLabels: Record<FeePresetName, string> = {
    low: t('fee.low'),
    standard: t('fee.standard'),
    high: t('fee.high'),
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        {mainLabel}
      </span>
      <div
        id={baseId}
        role="radiogroup"
        aria-label={groupLabel}
        className="grid grid-cols-3 gap-2"
      >
        {PRESETS.map((preset) => {
          const isSelected = selectedPreset === preset;
          const feeStroops = presets[preset];
          const costXlm = stroopsToXlm(feeStroops);
          const costString = t('fee.estimatedCost', { cost: costXlm });

          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled || loading}
              onClick={() => onPresetChange(preset)}
              className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? 'border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-200'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750'
              }`}
            >
              <span className="text-xs font-semibold">
                {presetLabels[preset]}
              </span>
              <span className="mt-1 text-[11px] font-mono opacity-80">
                {feeStroops} stroops
              </span>
              <span className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                {costString}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default FeeSelector;
