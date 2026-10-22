# Ledger Hardware Wallet Guide

This guide covers setting up and using the Ledger adapter that ships with the
**default** template:

- `src/lib/wallets/ledger-module.ts` → `LedgerWalletModule`
- registered in `src/lib/stellar-wallet-kit.ts` when `ledger` is in the
  wallet list

It explains what the adapter needs from the device, the browser and the
operating system, then walks through the connect ("pairing") and signing flows
exactly as the code implements them, and ends with a troubleshooting table that
maps the errors the adapter actually throws to fixes.

For the `ModuleInterface` the adapter implements, and for writing your own
adapter, see [custom-wallet-adapter-guide.md](custom-wallet-adapter-guide.md).

Paths below are relative to a scaffolded project. In this repository the same
files live under `src/templates/default/`.

## At a glance

| Topic         | What the adapter does                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Packages      | `@ledgerhq/hw-transport-webusb` (transport) and `@ledgerhq/hw-app-str` (Stellar app client), both dependencies of the default template.  |
| Transport     | WebUSB. Swappable through the `createTransport` option (see [Customising the adapter](#customising-the-adapter)).                        |
| Device app    | The Ledger **Stellar** app, open and unlocked.                                                                                           |
| Account       | `DEFAULT_LEDGER_PATH` = `44'/148'/0'` (SEP-0005, first account).                                                                         |
| Availability  | `isAvailable()` only checks that `navigator.usb` exists. It never touches the device.                                                    |
| Device access | Opens the transport, runs one request, closes the transport. Requests are queued so only one runs at a time.                             |
| Supported     | `getAddress`, `signTransaction`, `signAuthEntry` (Stellar app versions with Soroban authorization support), `getNetwork`, `disconnect`.  |
| Not supported | `signMessage` always throws `LedgerError` with code `NOT_SUPPORTED`.                                                                     |
| Errors        | `LedgerError` with `code`: `REJECTED`, `LOCKED`, `APP_NOT_OPEN`, `NOT_SUPPORTED` or `UNKNOWN` (see [Troubleshooting](#troubleshooting)). |

## Enabling the adapter

The Ledger adapter only exists in the **default** template. The other templates'
`stellar-wallet-kit` files do not register a Ledger module, so listing `ledger`
there has no effect.

**When scaffolding**, pick "Ledger" in the "Which wallet adapters?" prompt, or
pass it on the command line:

```bash
npx nextellar my-app --template default --wallets freighter,ledger
```

The scaffolder writes the chosen list into the `INJECTED_WALLETS` array literal
in `src/lib/stellar-wallet-kit.ts`. `getKit()` then adds a
`LedgerWalletModule` when that list includes `"ledger"`.

**In an existing project**, edit that array yourself:

```ts
// src/lib/stellar-wallet-kit.ts
const INJECTED_WALLETS: string[] = ["freighter", "ledger"];
```

`nextellar init` is not enough on its own: it only rewrites the `wallets` field
of `.nextellar/config.json` and never touches template files (see the comment
on `runInit` in `src/lib/init.ts`), and nothing in the app reads that field at
runtime.

There are no environment variables for the Ledger adapter. The commented
`NEXT_PUBLIC_WALLETS` line in `.env.example` is not read by
`stellar-wallet-kit.ts`.

## Prerequisites

### On the Ledger device

1. **Update the firmware** with Ledger Live. The WebUSB transport needs the
   device's WebUSB interface. If it is missing, the transport fails with
   `No WebUSB interface found for your Ledger device. Please upgrade firmware or contact techsupport.`
2. **Install the Stellar app** from Ledger Live's app catalog (My Ledger).
3. **Keep the Stellar app up to date.** `signAuthEntry` needs a Stellar app
   version that supports Soroban authorization. Older versions reject the
   request (see the `APP_NOT_OPEN` note in [Troubleshooting](#troubleshooting)).
4. Before connecting, **unlock the device with your PIN and open the Stellar
   app**.

The adapter never calls `signHash` from `@ledgerhq/hw-app-str`, so it does not
need the Stellar app's hash-signing setting turned on.

### On the computer

- **Close Ledger Live** (and any other wallet app or browser tab using the
  device) before connecting. The transport has to claim the device's USB
  interface. If another program holds it, opening fails and the adapter reports
  it as an `UNKNOWN` error.
- Connect the device directly over USB. The adapter does not use Bluetooth.

## Browser support

The default transport uses [WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API),
and `isAvailable()` simply checks whether `navigator.usb` exists. In practice:

| Browser                                         | Ledger adapter                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Chrome, Edge and other Chromium-based (desktop) | Supported (WebUSB). Some Chromium forks or enterprise policies may turn it off. |
| Firefox                                         | Not supported. `navigator.usb` does not exist.                                  |
| Safari (macOS and iOS)                          | Not supported. `navigator.usb` does not exist.                                  |

When WebUSB is missing, the kit's modal still lists Ledger but marks it
**"Not available"**. Clicking it opens the module's `productUrl`
(`https://www.ledger.com`) in a new tab instead of connecting. If code calls the
module directly anyway, every device call fails with:

```text
This browser cannot connect to a Ledger (WebUSB is unavailable).
```

### Secure context

Browsers only expose `navigator.usb` in a
[secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):

- `https://` origins, and
- `http://localhost` / `http://127.0.0.1` (so `npm run dev` works locally).

If you open the dev server on a LAN address, for example `http://192.168.1.20:3000`
from another machine, Ledger shows as "Not available". Use HTTPS (for example a
tunnel or a local certificate) for that kind of testing.

### Permissions-Policy and iframes

WebUSB is controlled by the `usb` Permissions-Policy feature, which browsers
allow for the page's own origin by default.

- The default template's `next.config.ts` sends
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`. That does not
  mention `usb`, so the default applies and WebUSB is allowed. **If you add
  `usb=()` to that header, the Ledger adapter stops working.**
- The same config also sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`,
  so the app cannot be embedded in an iframe at all. If you relax that to embed
  the app on another origin, the embedding page also has to grant USB access,
  for example `<iframe src="…" allow="usb">`.

### User gesture

The first time a site asks for a device, WebUSB shows the browser's device
chooser (`navigator.usb.requestDevice`, filtered to Ledger's USB vendor ID
`0x2c97`). The browser only allows that in response to a user action such as a
click. After the user has picked the device once, the browser remembers the
permission for that origin, and later connections reuse the device without a
chooser. You can revoke that permission in the browser's site settings.

This matters for the automatic reconnect on page load (see
[Reconnect on page load](#reconnect-on-page-load)).

## Operating system setup

### Linux: udev rules

On most Linux distributions a normal user cannot open the Ledger's USB device
until a udev rule grants access. Without it, Chromium may list the device in the
chooser but fail to open it, or not list it at all.

Ledger publishes its official rules and an installer script in the
[LedgerHQ/udev-rules](https://github.com/LedgerHQ/udev-rules) repository.
Prefer that file, since it tracks new device models. Its core entries match
Ledger's USB vendor ID, `2c97`:

```text
# /etc/udev/rules.d/20-hw1.rules
SUBSYSTEMS=="usb", ATTRS{idVendor}=="2c97", TAG+="uaccess", TAG+="udev-acl"
KERNEL=="hidraw*", ATTRS{idVendor}=="2c97", MODE="0666"
```

The first line covers raw USB access, which is what WebUSB uses. The second
covers the HID interface, which you need if you switch the adapter to WebHID.

After installing the rules, reload them and replug the device:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

If Chromium was installed as a Snap or Flatpak, its sandbox may also block raw
USB access. Grant USB access through the packaging system (for example the
Snap `raw-usb` interface), or use a browser installed from your distribution's
packages.

### Windows

No udev-style setup is needed. Make sure no other application (Ledger Live,
another browser window or tab, a desktop wallet) has the device open, because
only one process can claim its USB interface at a time.

### macOS

No extra setup is needed in Chromium-based browsers. Safari is not supported
(see [Browser support](#browser-support)).

## Connect ("pairing") flow

This is what happens, in order, when a user connects with Ledger through the
default template's `WalletProvider` (`src/contexts/WalletProvider.tsx`).

1. **The modal opens.** `connect()` calls `kit.openModal(...)`. The kit calls
   every module's `isAvailable()` and gives each one 500 ms. `LedgerWalletModule.isAvailable()`
   returns `true` when `navigator.usb` exists. It never opens the device, so it
   cannot trigger a permission prompt.
2. **The user picks Ledger.** The modal's `onWalletSelected` handler calls
   `kit.setWallet("ledger")` and then `kit.getAddress()`, which calls
   `LedgerWalletModule.getAddress()`.
3. **The request is queued.** `getAddress()` clears the cached address (the
   device may have been swapped) and runs the request through the module's
   internal queue, so it waits for any request already in progress.
4. **Support check.** If WebUSB is unavailable, the request fails with
   `NOT_SUPPORTED` before touching the device.
5. **The transport opens.** The default `createTransport` lazy-loads
   `@ledgerhq/hw-transport-webusb` and calls `TransportWebUSB.create()`. That
   reuses a Ledger this origin was already allowed to use. Otherwise it shows
   the browser's device chooser, where the user selects their Ledger.
6. **The Stellar app client is created.** The default `createApp` lazy-loads
   `@ledgerhq/hw-app-str` and wraps the transport in its `Str` class.
7. **The device returns the public key.** The adapter calls
   `app.getPublicKey(path, true, false)` with `path` = `44'/148'/0'` unless a
   `path` was passed or `defaultPath` was configured.
   - With `@ledgerhq/hw-app-str` 7.x, which the default template installs, the
     second argument is the library's `display` flag. **The device shows the
     address and asks the user to approve it**, so expect an on-device
     confirmation on every connect.
   - The adapter accepts both response shapes: a `G…` string `publicKey` (older
     library versions) or `rawPublicKey` bytes (7.x), which it encodes with
     `StrKey.encodeEd25519PublicKey`. If neither is present it throws
     `Ledger did not return a public key.`
   - The resolved address is cached per path for later signing calls.
8. **The transport closes.** It closes in a `finally` block, whether the request
   succeeded or failed, so the device is released for other tabs and apps
   between requests.
9. **The session is stored.** `WalletProvider` calls `getNetwork()`, which for
   Ledger returns the network the module was built with (a Ledger has no
   network setting of its own). It then saves `stellar_wallet_id = "ledger"`,
   the address and the wallet name through `src/lib/storage`, and loads
   balances from Horizon.

`disconnect()` only clears the adapter's cached address. There is no session
on the device to close.

### Errors during connect

The kit calls `onWalletSelected` without waiting for it. So an error from the
Ledger in steps 3–8 (locked device, app not open, rejected address, chooser
cancelled) does **not** reject the promise returned by `connect()`, and does not
increase its retry back-off counter. It shows up as an unhandled promise
rejection in the browser console. To show these errors in your UI, catch them
inside the `onWalletSelected` handler in `WalletProvider.tsx` and use the
`LedgerError` `code`/`message`.

### Reconnect on page load

On mount, `WalletProvider` tries to restore a saved session by calling
`kit.getAddress()` for the saved wallet. For Ledger that means:

- If the device is plugged in, unlocked, already allowed for this origin and
  showing the Stellar app, the adapter reads the public key again. With
  hw-app-str 7.x **the device asks the user to approve the address on page
  load**.
- If the device is unplugged, has never been allowed for this origin, is locked,
  is not showing the Stellar app, or the user rejects the address, `getAddress()`
  fails. In the "never allowed" case that is because the browser refuses to show
  the device chooser without a user gesture. `WalletProvider` then quietly
  deletes the saved session, and the user has to click Connect again.

## Signing flow

### Transactions

`WalletProvider.sendPayment()` builds the transaction and calls the
`signTransaction` helper in `src/lib/stellar-wallet-kit.ts`. That helper calls
`kit.signTransaction(xdr, { address })`, which ends up in
`LedgerWalletModule.signTransaction()`:

1. **The network is chosen.** The network passphrase comes from
   `opts.networkPassphrase`, falling back to the module's own `network`. The kit
   always fills `opts.networkPassphrase` from its own selected network, which
   `stellar-wallet-kit.ts` sets from the scaffold-time `{{NETWORK}}` value.
2. **The XDR is parsed** with `TransactionBuilder.fromXDR(xdr, networkPassphrase)`.
3. **The signer is resolved.** Inside the request queue, the adapter resolves the
   signer for `path` (default `44'/148'/0'`). If `getAddress()` already ran for
   that path, it uses the cached address and does not ask the device again.
4. **The signer is checked.** If `opts.address` is set and is not the address on
   that path, the adapter refuses **before** asking the device to sign:

   ```text
   Ledger path 44'/148'/0' controls G…, not the requested signer G….
   ```

5. **The device signs.** The adapter calls
   `app.signTransaction(path, tx.signatureBase())`. The Stellar app shows the
   transaction details on the device and the user approves or rejects them there.
6. **The signature is attached.** It is added with `tx.addSignature(signer, …)`,
   and the adapter returns `{ signedTxXdr, signerAddress }`.

If you swap devices, or change the seed on the device, reconnect before signing.
Only `getAddress()` refreshes the cached address.

### Soroban authorization entries

`signAuthEntry(authEntry, opts)`:

- First checks that the app client has `signSorobanAuthorization`, which
  `@ledgerhq/hw-app-str` 7.x does. If it is missing, the adapter throws
  `NOT_SUPPORTED`:
  `This Ledger Stellar app version cannot sign Soroban auth entries. Update the app in Ledger Live.`
- Decodes `authEntry` from base64 and passes the bytes to
  `app.signSorobanAuthorization(path, …)`. Per `@ledgerhq/hw-app-str`, those
  bytes must be the Soroban authorization `HashIdPreimage` XDR.
- Returns `signedAuthEntry` as the **base64 signature bytes** from the device,
  plus `signerAddress`. It does not return a re-encoded authorization entry, so
  the caller has to attach the signature.

### Messages

`signMessage()` always throws `LedgerError` `NOT_SUPPORTED`:
`Ledger does not support signing arbitrary messages.`

## Choosing an account (derivation path)

The adapter uses BIP-44 paths of the form `44'/148'/N'` (SEP-0005), where `N`
is the account index. `DEFAULT_LEDGER_PATH` is `44'/148'/0'`.

- `getAddress({ path })`, `signTransaction(xdr, { path })` and
  `signAuthEntry(entry, { path })` accept a per-call path.
- `WalletProvider` never passes a path, so a stock app always uses the
  module's default path. To make the whole app use another account, pass
  `defaultPath` where the module is built in `src/lib/stellar-wallet-kit.ts`:

  ```ts
  new LedgerWalletModule({
    network: { network: "TESTNET", networkPassphrase: targetNetwork },
    defaultPath: "44'/148'/1'", // second account
  });
  ```

The address cache is per path, so switching paths always reads the public key
from the device again.

## Customising the adapter

`LedgerWalletModule` takes these options (`LedgerModuleOptions`):

| Option            | Default                                                         | Purpose                                                                                          |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `network`         | required                                                        | `{ network, networkPassphrase }` returned by `getNetwork()` and used as the fallback passphrase. |
| `defaultPath`     | `DEFAULT_LEDGER_PATH` (`44'/148'/0'`)                           | Path used when a call passes none.                                                               |
| `createTransport` | `TransportWebUSB.create()` from `@ledgerhq/hw-transport-webusb` | Opens a transport for each request.                                                              |
| `createApp`       | `new Str(transport)` from `@ledgerhq/hw-app-str`                | Wraps the transport in the Stellar app client.                                                   |
| `isSupported`     | `!!navigator.usb`                                               | Used by `isAvailable()` and checked before every device request.                                 |

To use **WebHID** instead of WebUSB, install `@ledgerhq/hw-transport-webhid`
(it is not a template dependency) and replace **both** the transport and the
support check. Otherwise availability is still based on WebUSB:

```ts
import TransportWebHID from "@ledgerhq/hw-transport-webhid";

new LedgerWalletModule({
  network: { network: "TESTNET", networkPassphrase: Networks.TESTNET },
  createTransport: () => TransportWebHID.create(),
  isSupported: () => typeof navigator !== "undefined" && "hid" in navigator,
});
```

WebHID has the same broad browser support as WebUSB (Chromium-based desktop
browsers only).

## Troubleshooting

Every device-side failure is passed through `mapLedgerError()`, which turns it
into a `LedgerError` with a `code` and a short message. Errors it does not
recognise become `UNKNOWN` with the message `Ledger error: <original message>`,
and the original error is kept on `err.cause`.

| What you see (`code` / message)                                                      | Cause                                                                                                                                                                                                                 | Fix                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger shows **"Not available"** in the modal                                        | `navigator.usb` is missing: unsupported browser, or not a secure context.                                                                                                                                             | Use a Chromium-based desktop browser on `https://` or `http://localhost`. See [Browser support](#browser-support).                                                      |
| `NOT_SUPPORTED` / `This browser cannot connect to a Ledger (WebUSB is unavailable).` | Same as above, when the module is called directly.                                                                                                                                                                    | Same as above.                                                                                                                                                          |
| `LOCKED` / `Unlock your Ledger and try again.`                                       | The device is locked (status `0x5515`).                                                                                                                                                                               | Enter your PIN, open the Stellar app, retry.                                                                                                                            |
| `APP_NOT_OPEN` / `Open the Stellar app on your Ledger and try again.`                | Dashboard or another app is open (status `0x6e00`, `0x6d00` or `0x6511`).                                                                                                                                             | Open the Stellar app, retry.                                                                                                                                            |
| `APP_NOT_OPEN` from `signAuthEntry` even though the Stellar app is open              | An older Stellar app that does not know the Soroban authorization instruction answers "instruction not supported" (`0x6d00`), which maps to `APP_NOT_OPEN`.                                                           | Update the Stellar app in Ledger Live.                                                                                                                                  |
| `UNKNOWN` / `Ledger error: User refused the request`                                 | The user rejected the address or the transaction on the device. With hw-app-str 7.x this arrives as `StellarUserRefusedError` without a status code, so it maps to `UNKNOWN`, not `REJECTED`.                         | Approve on the device, or treat it as a cancellation. To detect it in code, check `err.cause?.name === "StellarUserRefusedError"` as well as `err.code === "REJECTED"`. |
| `REJECTED` / `Request rejected on the Ledger device.`                                | A rejection reported as status `0x6985`, or any error whose message contains "denied" or "rejected". That includes browser USB errors such as an "access denied" when opening the device on Linux without udev rules. | Approve on the device. If you did not reject anything, check the [udev rules](#linux-udev-rules) and that no other program holds the device.                            |
| `UNKNOWN` / `Ledger error: Unable to parse the provided data`                        | The Stellar app could not parse the transaction or authorization payload.                                                                                                                                             | Update the Stellar app. Check the payload is what hw-app-str expects (signature base for transactions, `HashIdPreimage` for auth entries).                              |
| `UNKNOWN` / `Ledger error: The provided data is too large for the device to process` | The transaction exceeds what the app accepts.                                                                                                                                                                         | Split the work into smaller transactions, or update the Stellar app.                                                                                                    |
| `UNKNOWN` / `Ledger error: No WebUSB interface found for your Ledger device. …`      | Firmware too old to expose WebUSB.                                                                                                                                                                                    | Update the firmware in Ledger Live.                                                                                                                                     |
| `UNKNOWN` / `Ledger error: …` mentioning claiming the interface                      | Another program or tab holds the device, or (Linux) no udev rule.                                                                                                                                                     | Close Ledger Live and other tabs/apps using the device. On Linux, install the [udev rules](#linux-udev-rules). Replug.                                                  |
| `UNKNOWN` / `Ledger error: …` after closing the device chooser                       | The user cancelled the browser's device chooser.                                                                                                                                                                      | Click Connect again and pick the device.                                                                                                                                |
| `UNKNOWN` / `Ledger error: …` mentioning a user gesture                              | The device chooser was requested outside a click (for example during the reconnect on page load).                                                                                                                     | Connect from a button click. Once the device is allowed for the origin, later connections need no chooser.                                                              |
| `UNKNOWN` / `Ledger path … controls G…, not the requested signer G….`                | The address passed to `signTransaction` is not on the device path being used.                                                                                                                                         | Reconnect so the app uses the device's current address, or pass the matching `path`.                                                                                    |
| `UNKNOWN` / `Ledger did not return a public key.`                                    | The app client returned neither `publicKey` nor `rawPublicKey`.                                                                                                                                                       | Usually a mismatched or custom `createApp`. Use the default `@ledgerhq/hw-app-str`.                                                                                     |
| `NOT_SUPPORTED` / `Ledger does not support signing arbitrary messages.`              | `signMessage()` was called.                                                                                                                                                                                           | Not supported by this adapter. Use transaction or auth-entry signing instead.                                                                                           |
| Connect does nothing visible; an unhandled promise rejection appears in the console  | An error during `onWalletSelected` (see [Errors during connect](#errors-during-connect)).                                                                                                                             | Read the logged `LedgerError` and use the matching row above. Catch errors in `onWalletSelected` to show them in your UI.                                               |

The exact wording of the browser-originated messages (device chooser cancelled,
missing user gesture, failed interface claim) comes from the browser and varies
between versions. The adapter passes them through unchanged after
`Ledger error: `.

## Testing and mocking

`tests/wallets/ledger-module.test.ts` covers the adapter without hardware by
injecting a mocked transport and Stellar app client:

```ts
// kp is a Keypair; hash and Networks come from @stellar/stellar-sdk
const module = new LedgerWalletModule({
  network: { network: "TESTNET", networkPassphrase: Networks.TESTNET },
  createTransport: async () => ({ close: jest.fn(async () => undefined) }),
  createApp: () => ({
    getPublicKey: jest.fn(async () => ({ rawPublicKey: kp.rawPublicKey() })),
    signTransaction: jest.fn(async (_path, base) => ({
      signature: kp.sign(hash(Buffer.from(base))),
    })),
  }),
  isSupported: () => true,
});
```

The mocked "device" signs the hash of the signature base with a real keypair,
so the test can verify the returned envelope. The suite checks:

- `isAvailable()` returns `false` without WebUSB and never creates a transport
- the default SEP-0005 path, and that the transport is closed after each call
- both `getPublicKey` response shapes
- that the signed envelope verifies against the device key
- refusal when `address` is not on the path
- status-word mapping (`0x6985`, `0x5515`, `0x6e00`, plain errors)
- that concurrent requests are serialised
- recovery after a failed request
- Soroban auth-entry signing, and the `NOT_SUPPORTED` cases

Run it with:

```bash
npm test -- tests/wallets/ledger-module.test.ts
```

For UI work without a device, the default template's Storybook has a
`LedgerConnected` story for `WalletConnectButton`
(`src/components/WalletConnectButton.stories.tsx`), which uses a mocked wallet
context.

Before a release, test once with a real device on each browser/OS combination
you support. The mocks cannot cover WebUSB permissions, udev rules or what the
device screen shows.
