# Custom Wallet Adapter Guide

Nextellar's wallet support is built on
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit),
a plugin-based kit where each wallet (Freighter, Albedo, Lobstr, xBull, Hana)
is a separate **module** implementing a shared interface. This guide covers
that interface and walks through adding support for a wallet the kit doesn't
ship a module for.

If the wallet you want to support already has a module published for the kit
(check the kit's own repo and npm for `@creit.tech/*-module` packages), install
and register that instead of writing your own — only write a custom module
when none exists.

## Built-in adapters shipped by Nextellar

Besides the kit's own modules (Freighter, Albedo, Lobstr, xBull, Hana), the
**default** template ships two adapters in `src/lib/wallets/`. Both are
written against the same `ModuleInterface` described below. Enable them by
adding `ledger` and/or `walletconnect` to the wallet list (scaffold prompt,
`nextellar init`, or `INJECTED_WALLETS` in `src/lib/stellar-wallet-kit.ts`).

### Ledger (hardware wallet)

`src/lib/wallets/ledger-module.ts` → `LedgerWalletModule`

- Uses the Ledger **Stellar** app over WebUSB (`@ledgerhq/hw-transport-webusb`
  + `@ledgerhq/hw-app-str`, both already dependencies of the default template).
- Requirements: a Chromium-based browser (WebUSB), served over https or
  `localhost`, with the device unlocked and the Stellar app open.
- Default account path is `44'/148'/0'` (SEP-0005). Pass `{ path }` to
  `getAddress`/`signTransaction` to use another account.
- If `signTransaction` is called with an `address` that the path does not
  control, it refuses before the device is asked to sign.
- Device status words become `LedgerError` codes: `REJECTED` (user
  declined), `LOCKED`, `APP_NOT_OPEN`, `NOT_SUPPORTED`, `UNKNOWN`.
- Requests are serialised, and the transport is closed after every call.
- `signAuthEntry` works with Stellar app versions that support Soroban
  authorization. `signMessage` is not supported.
- `isAvailable()` only feature-detects WebUSB and never prompts for the device.

The transport and app are injectable, for WebHID/Bluetooth or for tests:

```ts
new LedgerWalletModule({
  network: { network: 'TESTNET', networkPassphrase: Networks.TESTNET },
  createTransport: () => TransportWebHID.create(),
});
```

### WalletConnect

`src/lib/wallets/walletconnect-module.ts` → `WalletConnectWalletModule`

It wraps the kit's `WalletConnectModule`, which loads lazily: the
WalletConnect SDK is only downloaded when a user picks it.

Setup:

1. Create a project at <https://cloud.reown.com> (formerly WalletConnect Cloud)
   and copy its **Project ID**.
2. Add your dApp's domain to the project's allow-list.
3. Set the env vars in `.env.local`:

   ```bash
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef
   NEXT_PUBLIC_WALLETCONNECT_APP_URL=https://your-dapp.example   # optional, defaults to window.location.origin
   NEXT_PUBLIC_WALLETCONNECT_ICON=https://your-dapp.example/icon.png  # optional
   ```

   The dApp name shown in wallets comes from `NEXT_PUBLIC_APP_NAME`.
4. Add `walletconnect` to the wallet list.

Behaviour:
- Without a project ID, WalletConnect does not appear in the modal.
- A malformed project ID or a non-https URL also keeps it hidden, and logs a
  `[wallet] WalletConnect disabled: …` warning.
- Rejected requests and expired sessions surface as clear errors.
- `getNetwork()` reports the configured network, because the WalletConnect
  protocol has no such call.

## Where wallets are wired up

- `src/lib/stellar-wallet-kit.ts` builds the `StellarWalletsKit` instance:
  it constructs one module per entry in the project's configured wallet list
  and passes them to `new StellarWalletsKit({ modules: [...] })`.
- `src/contexts/WalletProvider.tsx` calls `getKit()` and drives the connect/
  sign/disconnect flow (`openModal()`, `setWallet()`, `getAddress()`,
  `disconnect()`) against whatever modules were registered.

Neither file needs to know a module's internals — every module the kit is
given must satisfy the same `ModuleInterface`, so adding a new wallet is
purely a matter of writing one that does, then adding it to the `modules`
array in `stellar-wallet-kit.ts`.

## The `ModuleInterface`

From `@creit.tech/stellar-wallets-kit`'s `types.d.ts`:

```ts
interface ModuleInterface extends KitActions {
  moduleType: ModuleType; // HW_WALLET | HOT_WALLET | BRIDGE_WALLET | AIR_GAPED_WALLET
  productId: string; // stable id, e.g. "my_wallet"
  productName: string; // shown in the kit's built-in modal
  productUrl: string; // where to download/learn about the wallet
  productIcon: string; // icon shown in the modal

  isAvailable(): Promise<boolean>; // must resolve in < 500ms
  isPlatformWrapper?(): Promise<boolean>; // must resolve in < 500ms
}

interface KitActions {
  getAddress(params?: { path?: string; skipRequestAccess?: boolean }):
    Promise<{ address: string }>;
  signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }):
    Promise<{ signedTxXdr: string; signerAddress?: string }>;
  signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }):
    Promise<{ signedAuthEntry: string; signerAddress?: string }>;
  signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }):
    Promise<{ signedMessage: string; signerAddress?: string }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  disconnect?(): Promise<void>;
}
```

`isAvailable()` and `isPlatformWrapper()` gate whether the kit's modal even
offers the wallet, and both **must** resolve quickly (under 500ms) or the kit
treats the wallet as unavailable/not wrapping the page.

## Worked example: a minimal custom module

This is the shape a hand-written module takes, using a hypothetical
`window.myWallet` browser extension that exposes `connect()`, `sign()`, and
`getNetwork()`:

```ts
// src/lib/wallets/my-wallet-module.ts
import {
  ModuleInterface,
  ModuleType,
} from "@creit.tech/stellar-wallets-kit";

declare global {
  interface Window {
    myWallet?: {
      connect(): Promise<{ publicKey: string }>;
      sign(xdr: string, opts: { networkPassphrase?: string }): Promise<string>;
      getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    };
  }
}

export const MY_WALLET_ID = "my_wallet";

export class MyWalletModule implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET;
  productId = MY_WALLET_ID;
  productName = "My Wallet";
  productUrl = "https://example.com/my-wallet";
  productIcon = "https://example.com/my-wallet/icon.svg";

  async isAvailable(): Promise<boolean> {
    return typeof window !== "undefined" && !!window.myWallet;
  }

  async getAddress(): Promise<{ address: string }> {
    const { publicKey } = await window.myWallet!.connect();
    return { address: publicKey };
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string },
  ): Promise<{ signedTxXdr: string }> {
    const signedTxXdr = await window.myWallet!.sign(xdr, {
      networkPassphrase: opts?.networkPassphrase,
    });
    return { signedTxXdr };
  }

  async signAuthEntry(): Promise<{ signedAuthEntry: string }> {
    throw new Error("My Wallet does not support signing auth entries");
  }

  async signMessage(): Promise<{ signedMessage: string }> {
    throw new Error("My Wallet does not support signing arbitrary messages");
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    return window.myWallet!.getNetwork();
  }
}
```

A method your wallet genuinely cannot support (many wallets don't implement
`signAuthEntry` or `signMessage`) should still exist on the class and throw a
clear error, rather than being omitted — omitting it is a type error, since
`ModuleInterface` requires all of `KitActions` except `disconnect`.

## Registering the module

Add it to the `modules` array in `src/lib/stellar-wallet-kit.ts`, following
the same pattern the built-in wallets use:

```ts
import { MyWalletModule } from "./wallets/my-wallet-module";

// ...inside getKit(), alongside the existing walletList.includes(...) checks:
if (walletList.includes("my_wallet")) modules.push(new MyWalletModule());
```

If you want the wallet selectable from the scaffolding prompts and `add`
command rather than hand-edited in every project, also add an entry to the
wallet option list in `src/lib/prompts.ts` (`runInteractivePrompts`'s
`multiselect` options) and `src/lib/init.ts` (`WALLET_OPTIONS`) using the same
`productId` you gave the module.

## Testing your module

Mock `window.myWallet` in a test the same way `tests/hooks/WalletProvider.*.test.tsx`
mock the kit itself (see `jest.unstable_mockModule` for `../lib/stellar-wallet-kit.js`
in those files) rather than hitting a real browser extension. At minimum, cover:

- `isAvailable()` returning `false` when the extension is absent
- `getAddress()` surfacing the connected address
- `signTransaction()` round-tripping a signed XDR
- an unsupported method (if any) throwing rather than silently returning an
  empty result
