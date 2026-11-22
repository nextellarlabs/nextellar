/**
 * Ledger hardware wallet adapter for the wallet-adapter plugin system
 * (`@creit.tech/stellar-wallets-kit` `ModuleInterface`).
 *
 * Talks to the Ledger "Stellar" app over WebUSB via `@ledgerhq/hw-app-str`.
 * The transport and app are injectable, so the adapter can be unit tested with
 * a mocked transport and swapped to WebHID/Bluetooth without forking it.
 *
 * Each call opens the transport, runs one APDU exchange and closes it again.
 * Calls are serialised, because a Ledger can only handle one request at a time.
 *
 * Registered in `stellar-wallet-kit.ts` when "ledger" is in the wallet list.
 * See docs/custom-wallet-adapter-guide.md.
 */

import { StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import type { ModuleInterface, ModuleType } from '@creit.tech/stellar-wallets-kit';

export const LEDGER_WALLET_ID = 'ledger';
/** BIP-44 path for the first Stellar account (SEP-0005). */
export const DEFAULT_LEDGER_PATH = "44'/148'/0'";

/** Minimal transport surface used by the adapter (matches @ledgerhq/hw-transport). */
export interface LedgerTransport {
  close(): Promise<void>;
}

/** Minimal Stellar app surface used by the adapter (matches @ledgerhq/hw-app-str v6/v7). */
export interface LedgerStellarApp {
  getPublicKey(
    path: string,
    boolValidate?: boolean,
    boolDisplay?: boolean,
  ): Promise<{ publicKey?: string; rawPublicKey?: Uint8Array }>;
  signTransaction(path: string, transaction: Uint8Array): Promise<{ signature: Uint8Array }>;
  signSorobanAuthorization?(path: string, hashIdPreimage: Uint8Array): Promise<{ signature: Uint8Array }>;
}

export interface LedgerModuleOptions {
  /** Network the dApp is on; Ledger itself has no network setting. */
  network: { network: string; networkPassphrase: string };
  /** Derivation path when the caller passes none. */
  defaultPath?: string;
  /** Creates a transport. Defaults to WebUSB (`@ledgerhq/hw-transport-webusb`). */
  createTransport?: () => Promise<LedgerTransport>;
  /** Wraps a transport in the Stellar app client. Defaults to `@ledgerhq/hw-app-str`. */
  createApp?: (transport: LedgerTransport) => LedgerStellarApp | Promise<LedgerStellarApp>;
  /** Whether this browser can talk to a Ledger. Defaults to WebUSB detection. */
  isSupported?: () => boolean;
}

export class LedgerError extends Error {
  readonly code: 'REJECTED' | 'LOCKED' | 'APP_NOT_OPEN' | 'NOT_SUPPORTED' | 'UNKNOWN';
  constructor(code: LedgerError['code'], message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Translate Ledger status words into errors a user can act on. */
export function mapLedgerError(err: unknown): LedgerError {
  if (err instanceof LedgerError) return err;
  const statusCode = (err as { statusCode?: number })?.statusCode;
  const message = String((err as Error)?.message ?? err);
  if (statusCode === 0x6985 || /denied|rejected/i.test(message)) {
    return new LedgerError('REJECTED', 'Request rejected on the Ledger device.', { cause: err });
  }
  if (statusCode === 0x5515 || /locked/i.test(message)) {
    return new LedgerError('LOCKED', 'Unlock your Ledger and try again.', { cause: err });
  }
  if (statusCode === 0x6e00 || statusCode === 0x6d00 || statusCode === 0x6511 || /CLA_NOT_SUPPORTED|app.*not.*open/i.test(message)) {
    return new LedgerError('APP_NOT_OPEN', 'Open the Stellar app on your Ledger and try again.', { cause: err });
  }
  return new LedgerError('UNKNOWN', `Ledger error: ${message}`, { cause: err });
}

const defaultCreateTransport = async (): Promise<LedgerTransport> => {
  const mod = await import('@ledgerhq/hw-transport-webusb');
  return mod.default.create();
};

const defaultCreateApp = async (transport: LedgerTransport): Promise<LedgerStellarApp> => {
  const mod = await import('@ledgerhq/hw-app-str');
  const Str = mod.default as unknown as new (t: LedgerTransport) => LedgerStellarApp;
  return new Str(transport);
};

const defaultIsSupported = () =>
  typeof navigator !== 'undefined' && !!(navigator as Navigator & { usb?: unknown }).usb;

export class LedgerWalletModule implements ModuleInterface {
  moduleType = 'HW_WALLET' as ModuleType;
  productId = LEDGER_WALLET_ID;
  productName = 'Ledger';
  productUrl = 'https://www.ledger.com';
  productIcon = 'https://stellar.creit.tech/wallet-icons/ledger.png';

  private readonly options: Required<Omit<LedgerModuleOptions, 'network'>> & Pick<LedgerModuleOptions, 'network'>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastAddress: { path: string; address: string } | null = null;

  constructor(options: LedgerModuleOptions) {
    this.options = {
      defaultPath: DEFAULT_LEDGER_PATH,
      createTransport: defaultCreateTransport,
      createApp: defaultCreateApp,
      isSupported: defaultIsSupported,
      ...options,
    };
  }

  async isAvailable(): Promise<boolean> {
    // Must resolve fast (< 500ms) — only feature-detect, never touch the device.
    try {
      return this.options.isSupported();
    } catch {
      return false;
    }
  }

  async isPlatformWrapper(): Promise<boolean> {
    return false;
  }

  /** Run `fn` with an open app, one request at a time, always closing the transport. */
  private withApp<T>(fn: (app: LedgerStellarApp) => Promise<T>): Promise<T> {
    const run = async () => {
      if (!this.options.isSupported()) {
        throw new LedgerError('NOT_SUPPORTED', 'This browser cannot connect to a Ledger (WebUSB is unavailable).');
      }
      let transport: LedgerTransport | undefined;
      try {
        transport = await this.options.createTransport();
        const app = await this.options.createApp(transport);
        return await fn(app);
      } catch (err) {
        throw mapLedgerError(err);
      } finally {
        await transport?.close().catch(() => undefined);
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async getAddress(params?: { path?: string }): Promise<{ address: string }> {
    const path = params?.path ?? this.options.defaultPath;
    // Always ask the device (it may have been swapped); refreshes the cache.
    this.lastAddress = null;
    const address = await this.withApp((app) => this.resolveAddress(app, path));
    return { address };
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const networkPassphrase = opts?.networkPassphrase ?? this.options.network.networkPassphrase;
    const path = opts?.path ?? this.options.defaultPath;
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);

    return this.withApp(async (app) => {
      const signer = await this.resolveAddress(app, path);
      if (opts?.address && opts.address !== signer) {
        throw new LedgerError(
          'UNKNOWN',
          `Ledger path ${path} controls ${signer}, not the requested signer ${opts.address}.`,
        );
      }
      const { signature } = await app.signTransaction(path, tx.signatureBase());
      tx.addSignature(signer, Buffer.from(signature).toString('base64'));
      return { signedTxXdr: tx.toXDR(), signerAddress: signer };
    });
  }

  async signAuthEntry(
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    const path = opts?.path ?? this.options.defaultPath;
    return this.withApp(async (app) => {
      if (typeof app.signSorobanAuthorization !== 'function') {
        throw new LedgerError(
          'NOT_SUPPORTED',
          'This Ledger Stellar app version cannot sign Soroban auth entries. Update the app in Ledger Live.',
        );
      }
      const signer = await this.resolveAddress(app, path);
      const { signature } = await app.signSorobanAuthorization(path, Buffer.from(authEntry, 'base64'));
      return { signedAuthEntry: Buffer.from(signature).toString('base64'), signerAddress: signer };
    });
  }

  async signMessage(): Promise<{ signedMessage: string; signerAddress?: string }> {
    throw new LedgerError('NOT_SUPPORTED', 'Ledger does not support signing arbitrary messages.');
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    return this.options.network;
  }

  async disconnect(): Promise<void> {
    this.lastAddress = null;
  }

  private async resolveAddress(app: LedgerStellarApp, path: string): Promise<string> {
    if (this.lastAddress?.path === path) return this.lastAddress.address;
    const res = await app.getPublicKey(path, true, false);
    const address =
      res.publicKey && StrKey.isValidEd25519PublicKey(res.publicKey)
        ? res.publicKey
        : res.rawPublicKey
          ? StrKey.encodeEd25519PublicKey(Buffer.from(res.rawPublicKey))
          : null;
    if (!address) throw new LedgerError('UNKNOWN', 'Ledger did not return a public key.');
    this.lastAddress = { path, address };
    return address;
  }
}
