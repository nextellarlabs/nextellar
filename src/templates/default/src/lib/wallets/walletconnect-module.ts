/**
 * WalletConnect adapter for the wallet-adapter plugin system
 * (`@creit.tech/stellar-wallets-kit` `ModuleInterface`).
 *
 * Wraps the kit's own `WalletConnectModule` and adds:
 *   - configuration from env with validation (a missing or malformed project
 *     ID hides the wallet instead of failing when the user clicks it)
 *   - lazy loading: the WalletConnect SDK (~200 KB) is only downloaded when
 *     the user actually picks WalletConnect
 *   - consistent errors for rejected or expired sessions
 *
 * Setup: create a project at https://cloud.reown.com (formerly WalletConnect
 * Cloud), then set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. See
 * docs/custom-wallet-adapter-guide.md.
 */

import type { ModuleInterface, ModuleType } from '@creit.tech/stellar-wallets-kit';

export const WALLETCONNECT_WALLET_ID = 'wallet_connect';

export interface WalletConnectConfig {
  projectId: string;
  name: string;
  description: string;
  url: string;
  icons: string[];
  /** WalletNetwork passphrase the dApp runs on. */
  network: string;
  /** `stellar_signXDR` (wallet returns the signed XDR) or `stellar_signAndSubmitXDR`. */
  method?: 'stellar_signXDR' | 'stellar_signAndSubmitXDR';
}

/** The parts of the kit's WalletConnectModule this adapter relies on. */
export type WalletConnectInner = Pick<
  ModuleInterface,
  'getAddress' | 'signTransaction' | 'signAuthEntry' | 'signMessage'
> & { disconnect?: () => Promise<void> };

export type WalletConnectLoader = (config: WalletConnectConfig) => Promise<WalletConnectInner>;

const PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/i;

export class WalletConnectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletConnectConfigError';
  }
}

/**
 * Read WalletConnect settings from public env vars.
 *
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID   required, 32 hex chars
 * NEXT_PUBLIC_WALLETCONNECT_APP_URL      optional, https URL of your dApp
 * NEXT_PUBLIC_WALLETCONNECT_ICON         optional, https URL of a square icon
 * NEXT_PUBLIC_APP_NAME                   used as the dApp name shown in wallets
 *
 * @returns null when no project ID is configured (WalletConnect stays hidden).
 * @throws WalletConnectConfigError when a value is present but invalid.
 */
export function readWalletConnectConfig(
  env: Record<string, string | undefined>,
  network: string,
): WalletConnectConfig | null {
  const projectId = env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) return null;
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new WalletConnectConfigError(
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be the 32-character project ID from cloud.reown.com.',
    );
  }

  const checkHttps = (name: string, value: string | undefined) => {
    if (!value) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new WalletConnectConfigError(`${name} must be a valid URL.`);
    }
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new WalletConnectConfigError(`${name} must use https.`);
    }
    return value;
  };

  const url =
    checkHttps('NEXT_PUBLIC_WALLETCONNECT_APP_URL', env.NEXT_PUBLIC_WALLETCONNECT_APP_URL) ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const icon = checkHttps('NEXT_PUBLIC_WALLETCONNECT_ICON', env.NEXT_PUBLIC_WALLETCONNECT_ICON);
  const name = env.NEXT_PUBLIC_APP_NAME?.trim() || 'Nextellar dApp';

  return {
    projectId,
    name,
    description: `${name} on Stellar`,
    url,
    icons: icon ? [icon] : [],
    network,
  };
}

const defaultLoader: WalletConnectLoader = async (config) => {
  const mod = await import('@creit.tech/stellar-wallets-kit/modules/walletconnect.module');
  return new mod.WalletConnectModule({
    projectId: config.projectId,
    name: config.name,
    description: config.description,
    url: config.url,
    icons: config.icons,
    method: (config.method ?? 'stellar_signXDR') as never,
    network: config.network as never,
  });
};

function normalize(err: unknown): Error {
  const message = String((err as Error)?.message ?? err);
  if (/reject|denied|cancel/i.test(message)) {
    return new Error('WalletConnect request was rejected in the wallet.');
  }
  if (/expired|no matching key|session.*(not found|deleted)/i.test(message)) {
    return new Error('WalletConnect session expired. Reconnect your wallet.');
  }
  return err instanceof Error ? err : new Error(message);
}

export class WalletConnectWalletModule implements ModuleInterface {
  moduleType = 'BRIDGE_WALLET' as ModuleType;
  productId = WALLETCONNECT_WALLET_ID;
  productName = 'WalletConnect';
  productUrl = 'https://walletconnect.com';
  productIcon = 'https://stellar.creit.tech/wallet-icons/walletconnect.png';

  private inner: Promise<WalletConnectInner> | null = null;

  constructor(
    private readonly config: WalletConnectConfig,
    private readonly loader: WalletConnectLoader = defaultLoader,
  ) {
    if (!PROJECT_ID_PATTERN.test(config.projectId)) {
      throw new WalletConnectConfigError('WalletConnect projectId must be a 32-character hex string.');
    }
  }

  async isAvailable(): Promise<boolean> {
    // Configured = available; no network calls here (must resolve < 500ms).
    return true;
  }

  async isPlatformWrapper(): Promise<boolean> {
    return false;
  }

  private load(): Promise<WalletConnectInner> {
    if (!this.inner) {
      this.inner = this.loader(this.config).catch((err) => {
        this.inner = null; // allow a retry after a failed load
        throw normalize(err);
      });
    }
    return this.inner;
  }

  private async call<T>(fn: (inner: WalletConnectInner) => Promise<T>): Promise<T> {
    const inner = await this.load();
    try {
      return await fn(inner);
    } catch (err) {
      throw normalize(err);
    }
  }

  getAddress(params?: { path?: string; skipRequestAccess?: boolean }) {
    return this.call((inner) => inner.getAddress(params));
  }

  signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }) {
    return this.call((inner) =>
      inner.signTransaction(xdr, { networkPassphrase: this.config.network, ...opts }),
    );
  }

  signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }) {
    return this.call((inner) => inner.signAuthEntry(authEntry, opts));
  }

  signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }) {
    return this.call((inner) => inner.signMessage(message, opts));
  }

  /**
   * The kit's WalletConnect module throws for getNetwork (the protocol has no
   * such call), so report the network this dApp was configured for instead.
   */
  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    const network = /^Public Global/.test(this.config.network) ? 'PUBLIC' : 'TESTNET';
    return { network, networkPassphrase: this.config.network };
  }

  async disconnect(): Promise<void> {
    if (!this.inner) return;
    const inner = await this.inner.catch(() => null);
    this.inner = null;
    await inner?.disconnect?.();
  }
}

/**
 * Build the WalletConnect module from env, or null when it is not configured
 * or misconfigured (a warning is logged so the misconfiguration is visible).
 */
export function createWalletConnectModule(
  env: Record<string, string | undefined>,
  network: string,
  loader?: WalletConnectLoader,
): WalletConnectWalletModule | null {
  try {
    const config = readWalletConnectConfig(env, network);
    return config ? new WalletConnectWalletModule(config, loader) : null;
  } catch (err) {
    console.warn(`[wallet] WalletConnect disabled: ${(err as Error).message}`);
    return null;
  }
}
