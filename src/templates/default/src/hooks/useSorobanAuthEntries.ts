'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Address,
  authorizeEntry,
  Networks,
  rpc,
  type SigningCallback,
  type xdr,
} from '@stellar/stellar-sdk';
import { useWallet, useWalletConfig } from '../contexts';
import { kit } from '../lib/stellar-wallet-kit';

const DEFAULT_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const AUTH_ENTRY_VALIDITY_WINDOW = 100;

export interface SorobanAuthEntriesOptions {
  /** Soroban RPC endpoint URL. Defaults to the wallet provider's URL or testnet. */
  sorobanRpc?: string;
  /** Selects a built-in network when set; otherwise uses the provider passphrase. */
  network?: 'TESTNET' | 'PUBLIC';
}

export interface SorobanAuthEntriesReturn {
  /** Signs each entry for the connected account and updates its expiration ledger. */
  signAuthEntries: (
    entries: xdr.SorobanAuthorizationEntry[],
  ) => Promise<xdr.SorobanAuthorizationEntry[]>;
  loading: boolean;
  error: Error | null;
}

function getEntryInvoker(entry: xdr.SorobanAuthorizationEntry): string {
  const credentials = entry.credentials;
  let addressCredentials: xdr.SorobanAddressCredentials;
  switch (credentials.type) {
    case 'sorobanCredentialsAddress':
      addressCredentials = credentials.address;
      break;
    case 'sorobanCredentialsAddressV2':
      addressCredentials = credentials.addressV2;
      break;
    case 'sorobanCredentialsAddressWithDelegates':
      addressCredentials = credentials.addressWithDelegates.addressCredentials;
      break;
    default:
      throw new Error(
        'Only address-based Soroban authorization entries can be signed by a connected wallet.',
      );
  }
  return Address.fromScAddress(addressCredentials.address).toString();
}

/**
 * Signs Soroban authorization entries for the connected wallet.
 *
 * Each signature expires 100 ledgers after the latest ledger reported by
 * Soroban RPC. The wallet is prompted once per entry.
 */
export function useSorobanAuthEntries(
  options: SorobanAuthEntriesOptions = {},
): SorobanAuthEntriesReturn {
  const { connected, publicKey, networkMismatch } = useWallet();
  const providerConfig = useWalletConfig();
  const {
    sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC,
    network,
  } = options;
  const networkPassphrase =
    network === 'PUBLIC'
      ? Networks.PUBLIC
      : network === 'TESTNET'
        ? Networks.TESTNET
        : providerConfig?.network ?? Networks.TESTNET;
  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signAuthEntries = useCallback(
    async (
      entries: xdr.SorobanAuthorizationEntry[],
    ): Promise<xdr.SorobanAuthorizationEntry[]> => {
      setLoading(true);
      setError(null);

      try {
        if (!connected || !publicKey) {
          throw new Error('A connected wallet is required to sign authorization entries.');
        }
        if (networkMismatch) {
          throw new Error('The connected wallet is on a different network.');
        }

        for (const entry of entries) {
          const invoker = getEntryInvoker(entry);
          if (invoker !== publicKey) {
            throw new Error(
              `Authorization entry invoker ${invoker} does not match the connected account ${publicKey}.`,
            );
          }
        }

        if (entries.length === 0) return [];

        const latestLedger = await rpcServer.getLatestLedger();
        if (!Number.isSafeInteger(latestLedger.sequence) || latestLedger.sequence < 1) {
          throw new Error('Soroban RPC returned an invalid latest ledger sequence.');
        }
        const validUntilLedger = latestLedger.sequence + AUTH_ENTRY_VALIDITY_WINDOW;
        if (!Number.isSafeInteger(validUntilLedger)) {
          throw new Error('The authorization entry expiration ledger is out of range.');
        }

        const signer: SigningCallback = async (preimage) => {
          const result = await kit().signAuthEntry(
            Buffer.from(preimage.toXDR()).toString('base64'),
            {
              address: publicKey,
              networkPassphrase,
            },
          );
          if (result.signerAddress && result.signerAddress !== publicKey) {
            throw new Error(
              `Wallet signed as ${result.signerAddress}, not the connected account ${publicKey}.`,
            );
          }
          return Buffer.from(result.signedAuthEntry, 'base64');
        };

        const signedEntries: xdr.SorobanAuthorizationEntry[] = [];
        for (const entry of entries) {
          signedEntries.push(
            await authorizeEntry(
              entry,
              signer,
              validUntilLedger,
              networkPassphrase,
              publicKey,
            ),
          );
        }
        return signedEntries;
      } catch (cause) {
        const failure =
          cause instanceof Error ? cause : new Error(String(cause));
        setError(failure);
        throw failure;
      } finally {
        setLoading(false);
      }
    },
    [connected, networkMismatch, networkPassphrase, publicKey, rpcServer],
  );

  return { signAuthEntries, loading, error };
}
