'use client';

import { useEffect, useState } from 'react';
import {
  isFederationAddress,
  resolveFederationAddress,
  Sep2Error,
  type FederationRecord,
  type ResolveFederationOptions,
} from '../lib/sep2';

export type FederationLookupStatus = 'idle' | 'resolving' | 'resolved' | 'error';

export interface UseFederationLookupOptions extends Omit<ResolveFederationOptions, 'signal'> {
  /** Wait this long after the last keystroke before resolving. Default 400ms. */
  debounceMs?: number;
}

export interface UseFederationLookupReturn {
  /** `idle` when the input is not a federation address (e.g. a G… key or empty). */
  status: FederationLookupStatus;
  record: FederationRecord | null;
  error: string | null;
}

const MESSAGES: Record<string, (address: string) => string> = {
  INVALID_ADDRESS: (a) => `"${a}" is not a valid federation address.`,
  NO_FEDERATION_SERVER: (a) => `${a.split('*')[1]} does not support federation addresses.`,
  NOT_FOUND: (a) => `No Stellar account found for ${a}.`,
  TIMEOUT: () => 'The federation server took too long to respond. Try again.',
  SERVER_ERROR: () => 'The federation server returned an error. Try again later.',
  INVALID_RESPONSE: () => 'The federation server returned an invalid answer. Use a G… address instead.',
};

/**
 * Resolves `name*domain.com` (SEP-2) as the user types, debounced and with
 * stale requests cancelled. Inputs that are not federation addresses are
 * ignored (`status: 'idle'`).
 */
export function useFederationLookup(
  input: string,
  options: UseFederationLookupOptions = {},
): UseFederationLookupReturn {
  const { debounceMs = 400, fetchImpl, timeoutMs, allowHttp } = options;
  const [state, setState] = useState<UseFederationLookupReturn>({ status: 'idle', record: null, error: null });

  useEffect(() => {
    const address = input.trim();
    if (!address.includes('*')) {
      setState({ status: 'idle', record: null, error: null });
      return undefined;
    }
    if (!isFederationAddress(address)) {
      setState({ status: 'error', record: null, error: MESSAGES.INVALID_ADDRESS(address) });
      return undefined;
    }

    setState({ status: 'resolving', record: null, error: null });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      resolveFederationAddress(address, { fetchImpl, timeoutMs, allowHttp, signal: controller.signal })
        .then((record) => {
          if (!controller.signal.aborted) setState({ status: 'resolved', record, error: null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Sep2Error
              ? (MESSAGES[err.code]?.(address) ?? err.message)
              : 'Could not resolve the federation address.';
          setState({ status: 'error', record: null, error: message });
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, debounceMs, fetchImpl, timeoutMs, allowHttp]);

  return state;
}
