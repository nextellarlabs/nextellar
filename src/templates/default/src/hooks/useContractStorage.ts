'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, xdr, Address, scValToNative } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { isValidContractId } from './useSorobanContract';

export type ContractStorageDurability = 'instance' | 'persistent' | 'temporary';

export interface UseContractStorageOptions {
  contractId: string;
  /** Key ScVal for contract data. Omit for the contract instance entry. */
  key?: xdr.ScVal;
  /** Defaults to `instance` when key is omitted, otherwise `persistent`. */
  durability?: ContractStorageDurability;
  sorobanRpc?: string;
  network?: 'TESTNET' | 'PUBLIC';
  /** Fetch on mount. Defaults to true. */
  enabled?: boolean;
}

export interface ContractStorageEntry {
  /** Decoded contract data, or a plain representation of the contract instance. */
  value: unknown;
  /** Last ledger sequence that modified this entry. */
  lastModifiedLedgerSeq: number;
  /** Ledger sequence at which this entry expires; null when not reported. */
  liveUntilLedgerSeq: number | null;
  /** Latest ledger known to the RPC server for this response. */
  latestLedger: number;
  /** Whether the entry is the contract instance or a data entry. */
  durability: ContractStorageDurability;
}

export interface UseContractStorageReturn {
  entry: ContractStorageEntry | null;
  value: unknown;
  liveUntilLedgerSeq: number | null;
  latestLedger: number | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';

/** Read and decode a Soroban contract instance or contract-data ledger entry. */
export function useContractStorage(opts: UseContractStorageOptions): UseContractStorageReturn {
  const providerConfig = useWalletConfig();
  const {
    contractId,
    key,
    durability = key ? 'persistent' : 'instance',
    sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_RPC,
    network = 'TESTNET',
    enabled = true,
  } = opts;
  const [entry, setEntry] = useState<ContractStorageEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const server = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  if (!isValidContractId(contractId)) {
    throw new Error(`Invalid Soroban contract ID: "${contractId}".`);
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const contractAddress = new Address(contractId);
      const storageKey = durability === 'instance'
        ? xdr.ScVal.scvLedgerKeyContractInstance()
        : key;
      if (!storageKey) throw new Error('A ScVal key is required for persistent or temporary storage.');
      const durabilityXdr = durability === 'temporary'
        ? xdr.ContractDataDurability.temporary()
        : xdr.ContractDataDurability.persistent();
      const ledgerKey = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: contractAddress.toScAddress(),
        key: storageKey,
        durability: durabilityXdr,
      }));
      const response = await server.getLedgerEntries(ledgerKey);
      if (response.entries.length === 0) {
        throw new Error(`No ${durability} storage entry found for contract ${contractId}.`);
      }
      const raw = response.entries[0];
      const ledgerData = raw.val.contractData();
      const value = durability === 'instance'
        ? decodeInstance(ledgerData.val().instance())
        : scValToNative(ledgerData.val());
      setEntry({
        value,
        lastModifiedLedgerSeq: raw.lastModifiedLedgerSeq,
        liveUntilLedgerSeq: raw.liveUntilLedgerSeq ?? null,
        latestLedger: response.latestLedger,
        durability,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [contractId, durability, key, server]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return {
    entry,
    value: entry?.value ?? null,
    liveUntilLedgerSeq: entry?.liveUntilLedgerSeq ?? null,
    latestLedger: entry?.latestLedger ?? null,
    loading,
    error,
    refresh,
  };
}

function decodeInstance(instance: xdr.ScContractInstance): Record<string, unknown> {
  const executable = instance.executable();
  const wasmHash = executable.switch().name === 'contractExecutableWasm'
    ? Buffer.from(executable.wasmHash()).toString('hex')
    : null;
  const storage = instance.storage() ?? [];
  return {
    executable: executable.switch().name,
    wasmHash,
    storage: storage.map((item) => ({
      key: scValToNative(item.key()),
      value: scValToNative(item.val()),
    })),
  };
}
