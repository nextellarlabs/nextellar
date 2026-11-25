'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { storage } from '../lib/storage';
import {
  discoverSep10Endpoint,
  fetchSep10Challenge,
  sep10TokenExpiry,
  submitSep10Challenge,
  verifySep10Challenge,
} from '../lib/sep10';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Signs a transaction envelope (base64 XDR) and returns the signed envelope. */
export type Sep10Signer = (
  transactionXdr: string,
  opts: { address: string; networkPassphrase: string },
) => Promise<string>;

export interface UseSep10AuthOptions {
  /** The anchor's home domain, e.g. `testanchor.stellar.org`. */
  homeDomain: string;
  /**
   * `WEB_AUTH_ENDPOINT` and `SIGNING_KEY`. When omitted they are read from the home domain's
   * stellar.toml on first use.
   */
  authEndpoint?: string;
  serverSigningKey?: string;
  /** Network passphrase. Defaults to the WalletProvider's network, then testnet. */
  networkPassphrase?: string;
  /** Signs the challenge. Defaults to the connected wallet (Stellar Wallets Kit). */
  signTransaction?: Sep10Signer;
  /** Optional client domain, for anchors that verify wallets. */
  clientDomain?: string;
  /** Allow plain-HTTP stellar.toml (local development only). */
  allowHttp?: boolean;
  /** Keep the JWT in localStorage until it expires (default true). */
  persist?: boolean;
  fetchImpl?: typeof fetch;
}

export interface UseSep10AuthReturn {
  /** Runs the SEP-10 flow for `account` (or reuses a cached, unexpired JWT) and returns the JWT. */
  authenticate: (account: string, opts?: { memo?: string }) => Promise<string>;
  /** Forgets the JWT, in memory and in storage. */
  logout: () => void;
  /** The current JWT, or null. */
  token: string | null;
  /** The account the JWT is for. */
  account: string | null;
  /** When the JWT expires (ms since epoch), from its `exp` claim. */
  expiresAt: number | null;
  /** True while a JWT is held and has not expired. */
  isAuthenticated: boolean;
  loading: boolean;
  error: Error | null;
}

type Session = { token: string; account: string; expiresAt: number | null };

/** Treat a JWT as expired this long before its `exp`, so it isn't sent at the last second. */
const EXPIRY_SKEW_MS = 30_000;

const storageKey = (homeDomain: string, account: string, memo?: string) =>
  `sep10:${homeDomain}:${account}${memo ? `:${memo}` : ''}`;

const isLive = (s: Session, now = Date.now()) => s.expiresAt === null || s.expiresAt - EXPIRY_SKEW_MS > now;

function readCached(key: string): Session | null {
  try {
    const raw = storage.get(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return typeof s?.token === 'string' && typeof s?.account === 'string' && isLive(s) ? s : null;
  } catch {
    return null;
  }
}

const walletSigner: Sep10Signer = async (transactionXdr, { address, networkPassphrase }) => {
  // Loaded lazily, as WalletProvider does, so the hook can be imported without a browser wallet.
  const { kit } = await import('../lib/stellar-wallet-kit');
  const { signedTxXdr } = await kit().signTransaction(transactionXdr, { address, networkPassphrase });
  return signedTxXdr;
};

/**
 * React hook for SEP-10 web authentication against an anchor: fetches the challenge from
 * `WEB_AUTH_ENDPOINT`, verifies it before signing (server signature, home domain,
 * web_auth_domain, time bounds, client account), has the wallet sign it, and exchanges it for a
 * JWT. The JWT is cached until its `exp` (in memory, and in localStorage unless `persist: false`),
 * so calling `authenticate` again returns it without a new signature.
 *
 * Nothing runs on mount: authentication asks the wallet for a signature, so it starts only when
 * `authenticate` is called. Pass the JWT to `useSep6`, `useSep24Interactive` or `useSep38Quote`.
 *
 * @example
 * const { publicKey } = useWallet();
 * const auth = useSep10Auth({ homeDomain: 'testanchor.stellar.org' });
 * const jwt = await auth.authenticate(publicKey!);
 */
export function useSep10Auth(options: UseSep10AuthOptions): UseSep10AuthReturn {
  const providerConfig = useWalletConfig();
  const {
    homeDomain,
    authEndpoint,
    serverSigningKey,
    networkPassphrase = providerConfig?.network ?? Networks.TESTNET,
    signTransaction = walletSigner,
    clientDomain,
    allowHttp,
    persist = true,
    fetchImpl,
  } = options;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Guards against an older authenticate() overwriting a newer one, or one finishing after logout.
  const requestIdRef = useRef(0);
  const keyRef = useRef<string | null>(null);

  // Re-render when the JWT expires, so isAuthenticated flips without a user action.
  useEffect(() => {
    if (!session?.expiresAt) return undefined;
    const ms = session.expiresAt - EXPIRY_SKEW_MS - Date.now();
    if (ms <= 0) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(ms, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [session]);

  const authenticate = useCallback(
    async (account: string, opts: { memo?: string } = {}): Promise<string> => {
      const key = storageKey(homeDomain, account, opts.memo);
      const cached =
        (session && keyRef.current === key && isLive(session) ? session : null) ??
        (persist ? readCached(key) : null);
      if (cached) {
        keyRef.current = key;
        setSession(cached);
        setError(null);
        return cached.token;
      }

      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const server =
          authEndpoint && serverSigningKey
            ? { endpoint: authEndpoint, serverSigningKey }
            : await discoverSep10Endpoint(homeDomain, { allowHttp });

        const challenge = await fetchSep10Challenge({
          endpoint: server.endpoint,
          account,
          homeDomain,
          memo: opts.memo,
          clientDomain,
          fetchImpl,
        });
        if (challenge.networkPassphrase && challenge.networkPassphrase !== networkPassphrase) {
          throw new Error(
            `useSep10Auth: the anchor signed the challenge for "${challenge.networkPassphrase}", but this app uses "${networkPassphrase}".`,
          );
        }
        verifySep10Challenge({
          transaction: challenge.transaction,
          serverSigningKey: server.serverSigningKey,
          networkPassphrase,
          homeDomain,
          account,
          webAuthDomain: new URL(server.endpoint).hostname,
        });

        const signed = await signTransaction(challenge.transaction, { address: account, networkPassphrase });
        const token = await submitSep10Challenge({ endpoint: server.endpoint, transaction: signed, fetchImpl });

        const next: Session = { token, account, expiresAt: sep10TokenExpiry(token) };
        if (requestId === requestIdRef.current) {
          keyRef.current = key;
          setSession(next);
          setNow(Date.now());
          if (persist) storage.set(key, JSON.stringify(next));
        }
        return token;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (requestId === requestIdRef.current) setError(e);
        throw e;
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [
      allowHttp,
      authEndpoint,
      clientDomain,
      fetchImpl,
      homeDomain,
      networkPassphrase,
      persist,
      serverSigningKey,
      session,
      signTransaction,
    ],
  );

  const logout = useCallback(() => {
    requestIdRef.current++;
    if (keyRef.current) storage.remove(keyRef.current);
    keyRef.current = null;
    setSession(null);
    setLoading(false);
    setError(null);
  }, []);

  const live = session !== null && isLive(session, now);
  return {
    authenticate,
    logout,
    token: live ? session.token : null,
    account: live ? session.account : null,
    expiresAt: live ? session.expiresAt : null,
    isAuthenticated: live,
    loading,
    error,
  };
}
