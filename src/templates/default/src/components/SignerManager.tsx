'use client';

import {
  useState,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';
import {
  Account,
  BASE_FEE,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { useWallet, useWalletConfig } from '../contexts';
import {
  I18nContext,
  I18nProvider,
  useTranslation,
} from '../contexts/I18nProvider';
import {
  useStellarAccount,
  type StellarAccountSigner,
  type StellarAccountThresholds,
} from '../hooks/useStellarAccount';
import AddressInput, { type AddressValidationResult } from './AddressInput';

export type LockoutRiskCode =
  | 'zero_total_weight'
  | 'master_disabled_no_cosigners'
  | 'below_low_threshold'
  | 'below_med_threshold'
  | 'below_high_threshold'
  | 'single_point_no_redundancy';

export interface LockoutRiskItem {
  code: LockoutRiskCode;
  severity: 'critical' | 'warning';
  effectiveTotalWeight: number;
  threshold?: number;
}

export interface StagedSignerChange {
  key: string;
  weight: number;
}

export interface SignerLockoutAnalysisInput {
  accountId: string;
  currentSigners: ReadonlyArray<StellarAccountSigner>;
  masterWeight: number;
  lowThreshold: number;
  medThreshold: number;
  highThreshold: number;
  stagedAdditions: ReadonlyArray<StagedSignerChange>;
  stagedRemovals: ReadonlyArray<string>;
}

export interface SignerLockoutAnalysis {
  effectiveTotalWeight: number;
  projectedMasterWeight: number;
  activeCoSignerCount: number;
  hasCriticalLockout: boolean;
  risks: LockoutRiskItem[];
}

export interface BuiltSetOptionsSummary {
  xdr: string;
  operationCount: number;
  effectiveTotalWeight: number;
  risks: LockoutRiskItem[];
}

export interface SignerManagerProps {
  /**
   * Account public key (`G...`) to manage. Falls back to the connected wallet
   * address when omitted.
   */
  accountAddress?: string;
  horizonUrl?: string;
  networkPassphrase?: string;
  /**
   * Invoked whenever a `setOptions` transaction XDR is built so parent flows
   * or multisig coordinators can sign and submit it.
   */
  onTransactionBuilt?: (
    xdr: string,
    summary: BuiltSetOptionsSummary,
  ) => void | Promise<void>;
  className?: string;
}

function parseWeightField(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num) || num < 0 || num > 255) {
    return null;
  }
  return num;
}

/**
 * Evaluates projected signer weights against proposed thresholds to catch
 * configurations that would brick the Stellar account or lock future
 * `setOptions` changes before building the transaction.
 */
export function analyzeSignerLockoutRisks(
  input: SignerLockoutAnalysisInput,
): SignerLockoutAnalysis {
  const weightsByKey = new Map<string, number>();

  for (const signer of input.currentSigners) {
    weightsByKey.set(signer.key, signer.weight);
  }

  weightsByKey.set(input.accountId, input.masterWeight);

  for (const removedKey of input.stagedRemovals) {
    if (removedKey !== input.accountId) {
      weightsByKey.set(removedKey, 0);
    }
  }

  for (const staged of input.stagedAdditions) {
    if (staged.key !== input.accountId) {
      weightsByKey.set(staged.key, staged.weight);
    }
  }

  const projectedMasterWeight = weightsByKey.get(input.accountId) ?? 0;
  let effectiveTotalWeight = 0;
  let activeCoSignerCount = 0;

  for (const [key, weight] of weightsByKey.entries()) {
    if (weight > 0) {
      effectiveTotalWeight += weight;
      if (key !== input.accountId) {
        activeCoSignerCount += 1;
      }
    }
  }

  const risks: LockoutRiskItem[] = [];

  if (effectiveTotalWeight === 0) {
    risks.push({
      code: 'zero_total_weight',
      severity: 'critical',
      effectiveTotalWeight,
    });
  }

  if (projectedMasterWeight === 0 && activeCoSignerCount === 0) {
    if (!risks.some((r) => r.code === 'zero_total_weight')) {
      risks.push({
        code: 'master_disabled_no_cosigners',
        severity: 'critical',
        effectiveTotalWeight,
      });
    }
  }

  if (effectiveTotalWeight > 0 && effectiveTotalWeight < input.lowThreshold) {
    risks.push({
      code: 'below_low_threshold',
      severity: 'critical',
      effectiveTotalWeight,
      threshold: input.lowThreshold,
    });
  }

  if (effectiveTotalWeight > 0 && effectiveTotalWeight < input.medThreshold) {
    risks.push({
      code: 'below_med_threshold',
      severity: 'critical',
      effectiveTotalWeight,
      threshold: input.medThreshold,
    });
  }

  if (effectiveTotalWeight > 0 && effectiveTotalWeight < input.highThreshold) {
    risks.push({
      code: 'below_high_threshold',
      severity: 'critical',
      effectiveTotalWeight,
      threshold: input.highThreshold,
    });
  }

  if (
    projectedMasterWeight === 0 &&
    activeCoSignerCount === 1 &&
    effectiveTotalWeight >= input.highThreshold
  ) {
    risks.push({
      code: 'single_point_no_redundancy',
      severity: 'warning',
      effectiveTotalWeight,
    });
  }

  return {
    effectiveTotalWeight,
    projectedMasterWeight,
    activeCoSignerCount,
    hasCriticalLockout: risks.some((r) => r.severity === 'critical'),
    risks,
  };
}

function formatTruncatedKey(key: string): string {
  if (key.length <= 16) {
    return key;
  }
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function resolveInitialMasterWeight(
  accountId: string,
  signers: ReadonlyArray<StellarAccountSigner>,
): number {
  const master = signers.find((s) => s.key === accountId);
  return master ? master.weight : 1;
}

function SignerManagerInner({
  accountAddress,
  horizonUrl,
  networkPassphrase,
  onTransactionBuilt,
  className = '',
}: SignerManagerProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const walletConfig = useWalletConfig();

  let walletPublicKey: string | undefined;
  try {
    const wallet = useWallet();
    walletPublicKey =
      wallet.publicKey ??
      (wallet as unknown as { address?: string }).address ??
      undefined;
  } catch {
    walletPublicKey = undefined;
  }

  const resolvedAddress = (accountAddress ?? walletPublicKey ?? '').trim();

  const {
    account,
    signers,
    thresholds,
    exists,
    loading,
    error,
    networkPassphrase: activeNetworkPassphrase,
    refresh,
  } = useStellarAccount(resolvedAddress || null, {
    horizonUrl: horizonUrl ?? walletConfig?.horizonUrl,
    networkPassphrase: networkPassphrase ?? walletConfig?.network,
  });

  const [masterWeightInput, setMasterWeightInput] = useState<string>('1');
  const [lowThresholdInput, setLowThresholdInput] = useState<string>('0');
  const [medThresholdInput, setMedThresholdInput] = useState<string>('0');
  const [highThresholdInput, setHighThresholdInput] = useState<string>('0');

  const [newSignerAddress, setNewSignerAddress] = useState<string>('');
  const [newSignerValidation, setNewSignerValidation] =
    useState<AddressValidationResult | null>(null);
  const [newSignerWeightInput, setNewSignerWeightInput] = useState<string>('1');
  const [stageError, setStageError] = useState<string | null>(null);

  const [stagedAdditions, setStagedAdditions] = useState<StagedSignerChange[]>(
    [],
  );
  const [stagedRemovals, setStagedRemovals] = useState<string[]>([]);

  const [acknowledgeLockout, setAcknowledgeLockout] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [builtXdr, setBuiltXdr] = useState<string | null>(null);
  const [builtOpCount, setBuiltOpCount] = useState<number>(0);
  const [building, setBuilding] = useState<boolean>(false);
  const [copiedXdr, setCopiedXdr] = useState<boolean>(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedSnapshotKeyRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const syncFromAccount = (
    acctId: string,
    acctSigners: ReadonlyArray<StellarAccountSigner>,
    acctThresholds: StellarAccountThresholds,
  ) => {
    setMasterWeightInput(
      String(resolveInitialMasterWeight(acctId, acctSigners)),
    );
    setLowThresholdInput(String(acctThresholds.low_threshold));
    setMedThresholdInput(String(acctThresholds.med_threshold));
    setHighThresholdInput(String(acctThresholds.high_threshold));
    setStagedAdditions([]);
    setStagedRemovals([]);
    setAcknowledgeLockout(false);
    setFormError(null);
    setStageError(null);
    setBuiltXdr(null);
    setBuiltOpCount(0);
  };

  useEffect(() => {
    if (!account || !thresholds) {
      return;
    }
    const snapshotKey = `${account.id}:${account.sequence}`;
    if (syncedSnapshotKeyRef.current !== snapshotKey) {
      syncedSnapshotKeyRef.current = snapshotKey;
      syncFromAccount(account.id, signers, thresholds);
    }
  }, [account, signers, thresholds]);

  const parsedMasterWeight = parseWeightField(masterWeightInput);
  const parsedLow = parseWeightField(lowThresholdInput);
  const parsedMed = parseWeightField(medThresholdInput);
  const parsedHigh = parseWeightField(highThresholdInput);

  const hasValidNumericFields =
    parsedMasterWeight !== null &&
    parsedLow !== null &&
    parsedMed !== null &&
    parsedHigh !== null;

  const initialMasterWeight = account
    ? resolveInitialMasterWeight(account.id, signers)
    : 1;

  const hasThresholdOrMasterDiff = Boolean(
    account &&
      thresholds &&
      hasValidNumericFields &&
      (parsedMasterWeight !== initialMasterWeight ||
        parsedLow !== thresholds.low_threshold ||
        parsedMed !== thresholds.med_threshold ||
        parsedHigh !== thresholds.high_threshold),
  );

  const hasAnyPendingChanges =
    hasThresholdOrMasterDiff ||
    stagedAdditions.length > 0 ||
    stagedRemovals.length > 0;

  const lockoutAnalysis = useMemo<SignerLockoutAnalysis>(() => {
    if (!account || !thresholds) {
      return {
        effectiveTotalWeight: 0,
        projectedMasterWeight: 0,
        activeCoSignerCount: 0,
        hasCriticalLockout: false,
        risks: [],
      };
    }
    return analyzeSignerLockoutRisks({
      accountId: account.id,
      currentSigners: signers,
      masterWeight: parsedMasterWeight ?? initialMasterWeight,
      lowThreshold: parsedLow ?? thresholds.low_threshold,
      medThreshold: parsedMed ?? thresholds.med_threshold,
      highThreshold: parsedHigh ?? thresholds.high_threshold,
      stagedAdditions,
      stagedRemovals,
    });
  }, [
    account,
    initialMasterWeight,
    parsedHigh,
    parsedLow,
    parsedMasterWeight,
    parsedMed,
    signers,
    stagedAdditions,
    stagedRemovals,
    thresholds,
  ]);

  // Reset confirmation whenever risk profile changes
  const riskSignature = lockoutAnalysis.risks
    .map((r) => `${r.code}:${r.effectiveTotalWeight}:${r.threshold ?? ''}`)
    .join('|');
  useEffect(() => {
    setAcknowledgeLockout(false);
  }, [riskSignature]);

  const formatRiskMessage = (risk: LockoutRiskItem): string => {
    switch (risk.code) {
      case 'zero_total_weight':
        return t('signerManager.warnings.zeroTotalWeight');
      case 'master_disabled_no_cosigners':
        return t('signerManager.warnings.masterDisabledNoCoSigners');
      case 'below_low_threshold':
        return t('signerManager.warnings.belowLowThreshold', {
          total: risk.effectiveTotalWeight,
          threshold: risk.threshold ?? 0,
        });
      case 'below_med_threshold':
        return t('signerManager.warnings.belowMedThreshold', {
          total: risk.effectiveTotalWeight,
          threshold: risk.threshold ?? 0,
        });
      case 'below_high_threshold':
        return t('signerManager.warnings.belowHighThreshold', {
          total: risk.effectiveTotalWeight,
          threshold: risk.threshold ?? 0,
        });
      case 'single_point_no_redundancy':
        return t('signerManager.warnings.singlePointNoRedundancy');
    }
  };

  const handleToggleRemoveSigner = (signerKey: string) => {
    setBuiltXdr(null);
    setFormError(null);
    setStagedRemovals((prev) =>
      prev.includes(signerKey)
        ? prev.filter((k) => k !== signerKey)
        : [...prev, signerKey],
    );
    setStagedAdditions((prev) => prev.filter((item) => item.key !== signerKey));
  };

  const handleStageSigner = () => {
    setStageError(null);
    setFormError(null);
    setBuiltXdr(null);

    const candidateKey = newSignerAddress.trim().toUpperCase();
    if (
      !candidateKey ||
      !StrKey.isValidEd25519PublicKey(candidateKey) ||
      (newSignerValidation && !newSignerValidation.isValid)
    ) {
      setStageError(t('signerManager.errors.invalidSignerAddress'));
      return;
    }

    if (account && candidateKey === account.id) {
      setStageError(t('signerManager.errors.cannotAddMasterAsCoSigner'));
      return;
    }

    const weightVal = parseWeightField(newSignerWeightInput);
    if (weightVal === null || weightVal < 1 || weightVal > 255) {
      setStageError(t('signerManager.errors.invalidSignerWeight'));
      return;
    }

    setStagedRemovals((prev) => prev.filter((k) => k !== candidateKey));
    setStagedAdditions((prev) => {
      const filtered = prev.filter((item) => item.key !== candidateKey);
      return [...filtered, { key: candidateKey, weight: weightVal }];
    });
    setNewSignerAddress('');
    setNewSignerValidation(null);
    setNewSignerWeightInput('1');
  };

  const handleUnstageAddition = (key: string) => {
    setBuiltXdr(null);
    setStagedAdditions((prev) => prev.filter((item) => item.key !== key));
  };

  const handleResetChanges = () => {
    if (account && thresholds) {
      syncFromAccount(account.id, signers, thresholds);
    }
  };

  const handleBuildSetOptions = async () => {
    setFormError(null);
    setBuiltXdr(null);

    if (!account || !thresholds) {
      return;
    }

    if (!hasValidNumericFields) {
      setFormError(t('signerManager.errors.invalidBounds'));
      return;
    }

    if (lockoutAnalysis.risks.length > 0 && !acknowledgeLockout) {
      setFormError(t('signerManager.errors.acknowledgeRequired'));
      return;
    }

    setBuilding(true);
    try {
      const sourceAccount = new Account(account.id, account.sequence);
      const builder = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: activeNetworkPassphrase,
      });

      const signerMutations: Array<{ key: string; weight: number }> = [
        ...stagedRemovals.map((key) => ({ key, weight: 0 })),
        ...stagedAdditions.map((s) => ({ key: s.key, weight: s.weight })),
      ];

      let operationCount = 0;

      if (hasThresholdOrMasterDiff) {
        const firstSigner = signerMutations.shift();
        builder.addOperation(
          Operation.setOptions({
            ...(parsedMasterWeight !== initialMasterWeight
              ? { masterWeight: parsedMasterWeight! }
              : {}),
            ...(parsedLow !== thresholds.low_threshold
              ? { lowThreshold: parsedLow! }
              : {}),
            ...(parsedMed !== thresholds.med_threshold
              ? { medThreshold: parsedMed! }
              : {}),
            ...(parsedHigh !== thresholds.high_threshold
              ? { highThreshold: parsedHigh! }
              : {}),
            ...(firstSigner
              ? {
                  signer: {
                    ed25519PublicKey: firstSigner.key,
                    weight: firstSigner.weight,
                  },
                }
              : {}),
          }),
        );
        operationCount += 1;
      }

      for (const mutation of signerMutations) {
        builder.addOperation(
          Operation.setOptions({
            signer: {
              ed25519PublicKey: mutation.key,
              weight: mutation.weight,
            },
          }),
        );
        operationCount += 1;
      }

      const tx = builder.setTimeout(180).build();
      const xdr = tx.toXDR();

      setBuiltXdr(xdr);
      setBuiltOpCount(operationCount);

      await onTransactionBuilt?.(xdr, {
        xdr,
        operationCount,
        effectiveTotalWeight: lockoutAnalysis.effectiveTotalWeight,
        risks: lockoutAnalysis.risks,
      });
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : String(err ?? 'Unknown error');
      setFormError(t('signerManager.errors.buildFailed', { reason }));
    } finally {
      setBuilding(false);
    }
  };

  const handleCopyXdr = async () => {
    if (!builtXdr || !navigator?.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(builtXdr);
      setCopiedXdr(true);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopiedXdr(false);
      }, 2000);
    } catch {
      // Ignore clipboard rejection
    }
  };

  const masterWeightFieldId = `${baseId}-master-weight`;
  const lowFieldId = `${baseId}-low-threshold`;
  const medFieldId = `${baseId}-med-threshold`;
  const highFieldId = `${baseId}-high-threshold`;
  const newSignerWeightFieldId = `${baseId}-new-signer-weight`;
  const ackCheckboxId = `${baseId}-ack-lockout`;

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className={`rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4 dark:border-gray-700">
        <div>
          <h2
            id={`${baseId}-heading`}
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('signerManager.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('signerManager.subtitle')}
          </p>
        </div>
        {resolvedAddress && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t('signerManager.refresh')}
            className="rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t('signerManager.refresh')}
          </button>
        )}
      </div>

      {!resolvedAddress && (
        <p className="mt-4 rounded-md bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {t('signerManager.connectPrompt')}
        </p>
      )}

      {resolvedAddress && loading && !account && (
        <p
          role="status"
          aria-live="polite"
          className="mt-4 text-sm text-gray-700 dark:text-gray-300"
        >
          {t('signerManager.loading')}
        </p>
      )}

      {resolvedAddress && error && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>{error.message}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {t('signerManager.retry')}
          </button>
        </div>
      )}

      {resolvedAddress && !loading && !error && !exists && (
        <p
          role="status"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {t('signerManager.unfundedNotice')}
        </p>
      )}

      {account && thresholds && exists && (
        <div className="mt-5 space-y-6">
          {/* Current Signers */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('signerManager.currentSignersHeading')}
            </h3>
            <ul className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {signers.map((signer) => {
                const isMaster = signer.key === account.id;
                const isMarkedRemoval = stagedRemovals.includes(signer.key);
                return (
                  <li
                    key={signer.key}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-xs text-gray-900 dark:text-gray-100">
                        {formatTruncatedKey(signer.key)}
                      </code>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                        {isMaster
                          ? t('signerManager.masterKeyBadge')
                          : t('signerManager.coSignerBadge')}
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                        {t('signerManager.weightBadge', {
                          weight: signer.weight,
                        })}
                      </span>
                      {isMarkedRemoval && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {t('signerManager.markedForRemoval')}
                        </span>
                      )}
                    </div>
                    {!isMaster && (
                      <button
                        type="button"
                        onClick={() => handleToggleRemoveSigner(signer.key)}
                        className="rounded px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950"
                      >
                        {isMarkedRemoval
                          ? t('signerManager.undoRemove')
                          : t('signerManager.removeSigner')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Thresholds & Master Weight */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('signerManager.thresholdsHeading')}
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor={masterWeightFieldId}
                  className="block text-xs font-medium text-gray-800 dark:text-gray-200"
                >
                  {t('signerManager.masterWeightLabel')}
                </label>
                <input
                  id={masterWeightFieldId}
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={masterWeightInput}
                  onChange={(e) => {
                    setMasterWeightInput(e.target.value);
                    setBuiltXdr(null);
                    setFormError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor={lowFieldId}
                  className="block text-xs font-medium text-gray-800 dark:text-gray-200"
                >
                  {t('signerManager.lowThresholdLabel')}
                </label>
                <input
                  id={lowFieldId}
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={lowThresholdInput}
                  onChange={(e) => {
                    setLowThresholdInput(e.target.value);
                    setBuiltXdr(null);
                    setFormError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor={medFieldId}
                  className="block text-xs font-medium text-gray-800 dark:text-gray-200"
                >
                  {t('signerManager.medThresholdLabel')}
                </label>
                <input
                  id={medFieldId}
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={medThresholdInput}
                  onChange={(e) => {
                    setMedThresholdInput(e.target.value);
                    setBuiltXdr(null);
                    setFormError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor={highFieldId}
                  className="block text-xs font-medium text-gray-800 dark:text-gray-200"
                >
                  {t('signerManager.highThresholdLabel')}
                </label>
                <input
                  id={highFieldId}
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={highThresholdInput}
                  onChange={(e) => {
                    setHighThresholdInput(e.target.value);
                    setBuiltXdr(null);
                    setFormError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              {t('signerManager.effectiveTotalWeight', {
                weight: lockoutAnalysis.effectiveTotalWeight,
              })}
            </p>
          </div>

          {/* Add or Update Co-Signer */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('signerManager.addSignerHeading')}
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-start">
              <div className="sm:col-span-8">
                <AddressInput
                  value={newSignerAddress}
                  allowedTypes={['G']}
                  label={t('signerManager.newSignerAddressLabel')}
                  placeholder={t('signerManager.newSignerAddressPlaceholder')}
                  onChange={(normalized, validation) => {
                    setNewSignerAddress(normalized);
                    setNewSignerValidation(validation);
                    setStageError(null);
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor={newSignerWeightFieldId}
                  className="block text-sm font-medium text-gray-800 dark:text-gray-200"
                >
                  {t('signerManager.newSignerWeightLabel')}
                </label>
                <input
                  id={newSignerWeightFieldId}
                  type="number"
                  min={1}
                  max={255}
                  step={1}
                  value={newSignerWeightInput}
                  onChange={(e) => {
                    setNewSignerWeightInput(e.target.value);
                    setStageError(null);
                  }}
                  className="mt-1.5 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              <div className="sm:col-span-2 sm:pt-6">
                <button
                  type="button"
                  onClick={handleStageSigner}
                  className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {t('signerManager.stageSignerButton')}
                </button>
              </div>
            </div>

            {stageError && (
              <p
                role="alert"
                className="mt-2 text-xs font-medium text-red-700 dark:text-red-400"
              >
                {stageError}
              </p>
            )}

            {stagedAdditions.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                  {t('signerManager.stagedAdditionsHeading')}
                </h4>
                <ul className="mt-1.5 divide-y divide-gray-200 rounded border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
                  {stagedAdditions.map((staged) => (
                    <li
                      key={staged.key}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-gray-900 dark:text-gray-100">
                          {formatTruncatedKey(staged.key)}
                        </code>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {t('signerManager.weightBadge', {
                            weight: staged.weight,
                          })}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnstageAddition(staged.key)}
                        className="rounded px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {t('signerManager.unstageSigner')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Lockout Warning Banner */}
          {lockoutAnalysis.risks.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-amber-500 bg-amber-50 p-4 dark:border-amber-500/80 dark:bg-amber-950/40"
            >
              <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-200">
                {t('signerManager.lockoutWarningTitle')}
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-950 dark:text-amber-200">
                {lockoutAnalysis.risks.map((risk) => (
                  <li key={risk.code}>{formatRiskMessage(risk)}</li>
                ))}
              </ul>
              <div className="mt-3 flex items-start gap-2">
                <input
                  id={ackCheckboxId}
                  type="checkbox"
                  checked={acknowledgeLockout}
                  onChange={(e) => {
                    setAcknowledgeLockout(e.target.checked);
                    setFormError(null);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-amber-600 text-amber-700 focus:ring-amber-500"
                />
                <label
                  htmlFor={ackCheckboxId}
                  className="text-xs font-medium text-amber-950 dark:text-amber-100"
                >
                  {t('signerManager.lockoutAcknowledgeLabel')}
                </label>
              </div>
            </div>
          )}

          {formError && (
            <p
              role="alert"
              className="text-xs font-medium text-red-700 dark:text-red-400"
            >
              {formError}
            </p>
          )}

          {!hasAnyPendingChanges && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t('signerManager.noPendingChanges')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!hasAnyPendingChanges || building}
              onClick={() => void handleBuildSetOptions()}
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {building
                ? t('signerManager.buildingTransaction')
                : t('signerManager.buildTransaction')}
            </button>
            {hasAnyPendingChanges && (
              <button
                type="button"
                onClick={handleResetChanges}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t('signerManager.resetChanges')}
              </button>
            )}
          </div>

          {builtXdr && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-800 dark:text-gray-200">
                  {t('signerManager.xdrHeading')}
                </h3>
                <button
                  type="button"
                  onClick={() => void handleCopyXdr()}
                  aria-label={
                    copiedXdr
                      ? t('signerManager.copiedXdr')
                      : t('signerManager.copyXdr')
                  }
                  className="rounded bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                >
                  {copiedXdr
                    ? t('signerManager.copiedXdr')
                    : t('signerManager.copyXdr')}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {t('signerManager.operationsCount', { count: builtOpCount })}
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2.5 font-mono text-xs text-gray-900 dark:bg-gray-950 dark:text-gray-100">
                {builtXdr}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Multisig signer & threshold management component for the default Nextellar
 * template. Reads on-chain account state via `useStellarAccount`, warns before
 * configurations that could lock the account, and builds unsigned `setOptions`
 * transactions via `@stellar/stellar-sdk`.
 */
export default function SignerManager(props: SignerManagerProps) {
  const i18n = useContext(I18nContext);
  if (i18n === undefined) {
    return (
      <I18nProvider>
        <SignerManagerInner {...props} />
      </I18nProvider>
    );
  }
  return <SignerManagerInner {...props} />;
}
