'use client';

import { useCallback, useRef, useState } from 'react';

export type Sep12KycStatus = 'NEEDS_INFO' | 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

export interface Sep12CustomerField {
  type?: 'string' | 'binary' | 'number' | 'date';
  description?: string;
  optional?: boolean;
  choices?: string[];
  [key: string]: unknown;
}

export interface Sep12ProvidedField extends Sep12CustomerField {
  status?: 'ACCEPTED' | 'PROCESSING' | 'REJECTED' | 'VERIFICATION_REQUIRED';
  error?: string;
}

export interface Sep12Customer {
  id?: string;
  /** PUT /customer may return only an id; fetch the status with getCustomer. */
  status?: Sep12KycStatus;
  fields?: Record<string, Sep12CustomerField>;
  provided_fields?: Record<string, Sep12ProvidedField>;
  message?: string;
  eta?: number;
  [key: string]: unknown;
}

export interface Sep12CustomerQuery {
  account?: string;
  id?: string;
  type?: string;
  transactionId?: string;
  memo?: string;
  memoType?: 'text' | 'id' | 'hash';
  lang?: string;
}

export interface Sep12FileUpload {
  /** Base64-encoded file contents, without a data-URL prefix. */
  data: string;
  contentType: string;
  name: string;
}

export interface Sep12CustomerSubmission extends Sep12CustomerQuery {
  fields?: Record<string, string>;
  files?: Record<string, Sep12FileUpload>;
}

export interface UseSep12KycOptions {
  /** The anchor's SEP-12 `KYC_SERVER` URL. */
  kycServer: string;
  /** SEP-10 JWT sent as a Bearer token on every request. */
  authToken: string;
  fetchImpl?: typeof fetch;
}

export interface UseSep12KycReturn {
  getCustomer: (params: Sep12CustomerQuery) => Promise<Sep12Customer>;
  submitCustomerInfo: (params: Sep12CustomerSubmission) => Promise<Sep12Customer>;
  customer: Sep12Customer | undefined;
  /** Current SEP-12 status: NEEDS_INFO, PROCESSING, ACCEPTED or REJECTED. */
  status: Sep12KycStatus | undefined;
  /** Fields requested by the anchor for the next submission. */
  fields: Record<string, Sep12CustomerField>;
  loading: boolean;
  error: Error | null;
  reset: () => void;
}

const KYC_STATUSES: Sep12KycStatus[] = [
  'NEEDS_INFO',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
];

function customerUrl(kycServer: string): string {
  if (typeof kycServer !== 'string' || !kycServer.trim()) {
    throw new Error('SEP-12 kycServer is required.');
  }
  return `${kycServer.trim().replace(/\/+$/, '')}/customer`;
}

function queryParams(params: Sep12CustomerQuery): URLSearchParams {
  const query = new URLSearchParams();
  if (params.account) query.set('account', params.account);
  if (params.id) query.set('id', params.id);
  if (params.type) query.set('type', params.type);
  if (params.transactionId) query.set('transaction_id', params.transactionId);
  if (params.memo) query.set('memo', params.memo);
  if (params.memoType) query.set('memo_type', params.memoType);
  if (params.lang) query.set('lang', params.lang);
  return query;
}

function parseCustomer(body: unknown, requireStatus: boolean): Sep12Customer {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('SEP-12 /customer returned an invalid response body.');
  }
  const response = body as Record<string, unknown>;
  if (requireStatus && typeof response.status !== 'string') {
    throw new Error('SEP-12 /customer response is missing customer status.');
  }
  if (
    response.status !== undefined &&
    (typeof response.status !== 'string' ||
      !KYC_STATUSES.includes(response.status as Sep12KycStatus))
  ) {
    throw new Error('SEP-12 /customer returned an unsupported customer status.');
  }
  if (
    response.fields !== undefined &&
    (!response.fields || typeof response.fields !== 'object' || Array.isArray(response.fields))
  ) {
    throw new Error('SEP-12 /customer returned invalid requested fields.');
  }
  if (
    !requireStatus &&
    (typeof response.id !== 'string' || !response.id.trim()) &&
    typeof response.status !== 'string'
  ) {
    throw new Error('SEP-12 /customer PUT response is missing a customer id.');
  }
  return response as Sep12Customer;
}

async function requestCustomer(
  url: string,
  authToken: string,
  fetchImpl: typeof fetch | undefined,
  init: RequestInit,
  requireStatus: boolean,
): Promise<Sep12Customer> {
  if (typeof authToken !== 'string' || !authToken.trim()) {
    throw new Error('A SEP-10 JWT is required for SEP-12 requests.');
  }
  const doFetch = fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...init.headers,
      },
    });
  } catch (err) {
    throw new Error(`SEP-12 request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await response.text();
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`SEP-12 /customer returned invalid JSON (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : response.statusText || 'request rejected';
    throw new Error(`SEP-12 /customer failed (${response.status}): ${message}`);
  }
  return parseCustomer(body, requireStatus);
}

/**
 * Reads customer KYC status and submits SEP-9 fields/files to an anchor's
 * SEP-12 KYC_SERVER. Requests are explicit and require a SEP-10 JWT.
 */
export function useSep12Kyc(options: UseSep12KycOptions): UseSep12KycReturn {
  const { kycServer, authToken, fetchImpl } = options;
  const [customer, setCustomer] = useState<Sep12Customer | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const run = useCallback(
    async (task: () => Promise<Sep12Customer>): Promise<Sep12Customer> => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await task();
        if (requestIdRef.current === requestId) setCustomer(result);
        return result;
      } catch (err) {
        const requestError = err instanceof Error ? err : new Error(String(err));
        if (requestIdRef.current === requestId) setError(requestError);
        throw requestError;
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [],
  );

  const getCustomer = useCallback(
    (params: Sep12CustomerQuery) =>
      run(() => {
        const url = customerUrl(kycServer);
        const query = queryParams(params).toString();
        return requestCustomer(
          query ? `${url}?${query}` : url,
          authToken,
          fetchImpl,
          { method: 'GET' },
          true,
        );
      }),
    [run, kycServer, authToken, fetchImpl],
  );

  const submitCustomerInfo = useCallback(
    (params: Sep12CustomerSubmission) =>
      run(() => {
        if (
          !Object.keys(params.fields ?? {}).length &&
          !Object.keys(params.files ?? {}).length
        ) {
          throw new Error('SEP-12 submission requires at least one field or file.');
        }
        const url = customerUrl(kycServer);
        const body = new FormData();
        for (const [key, value] of queryParams(params).entries()) body.append(key, value);
        for (const [key, value] of Object.entries(params.fields ?? {})) {
          body.append(key, value);
        }
        for (const [key, file] of Object.entries(params.files ?? {})) {
          const bytes = Uint8Array.from(atob(file.data), (character) =>
            character.charCodeAt(0),
          );
          body.append(key, new Blob([bytes], { type: file.contentType }), file.name);
        }
        return requestCustomer(
          url,
          authToken,
          fetchImpl,
          {
            method: 'PUT',
            body,
          },
          false,
        );
      }),
    [run, kycServer, authToken, fetchImpl],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setCustomer(undefined);
    setError(null);
    setLoading(false);
  }, []);

  return {
    getCustomer,
    submitCustomerInfo,
    customer,
    status: customer?.status,
    fields: customer?.fields ?? {},
    loading,
    error,
    reset,
  };
}
