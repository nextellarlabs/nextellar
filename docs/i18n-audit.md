# i18n Audit: Hardcoded UI Strings (default template)

## Overview

The `default` template already ships a working, opt-in i18n system:
`src/templates/default/src/contexts/I18nProvider.tsx` (a `useTranslation()` hook
exposing `t(path, params)`, dot-path message lookup, and `{token}` interpolation) and
`src/templates/default/src/locales/en.ts` (currently ~31 lines covering only a small
starter set of keys). It is **not wired into `layout.tsx` by default** — see
`I18nProvider`'s own doc comment for how to opt in.

Almost none of the actual component copy uses it yet. This doc is a full inventory of
every hardcoded English string in `src/templates/default/src/components/` (33 files:
17 components + their `.stories.tsx` files), so extraction work can be scoped and
prioritized deliberately instead of discovered ad hoc.

**Scope note:** this audit covers the `default` template only. `minimal`, `defi`,
`js-template`, and `js-defi` have their own component copies (mostly the same strings,
since several components started as ports of `default`'s) and would need their own
pass — not repeated here to keep this audit a manageable, reviewable size.

## Grand total

**≈150-180 hardcoded English UI strings** across all 33 files (≈163 in the 17 real
components, ≈15 in `.stories.tsx` files that render literal text via args/children).
The range depends on how you count `TransactionList.tsx`'s 29-entry operation-type
label map and repeated ternary branches — counting the map as one item instead of 29
puts the total closer to 150.

| #   | File                               | Hardcoded strings |
| --- | ---------------------------------- | ----------------: |
| 1   | AccountSwitcher.tsx                |                 1 |
| 2   | AccountSwitcher.stories.tsx        |                 0 |
| 3   | BalanceDisplay.tsx                 |                13 |
| 4   | BalanceDisplay.stories.tsx         |                 0 |
| 5   | ContractCallForm.tsx               |                12 |
| 6   | ContractCallForm.stories.tsx       |                 0 |
| 7   | ContractCallPreview.tsx            |                13 |
| 8   | ContractCallPreview.stories.tsx    |                 0 |
| 9   | CopyButton.tsx                     |                 4 |
| 10  | CopyButton.stories.tsx             |                 0 |
| 11  | EmptyState.tsx                     |                 0 |
| 12  | EmptyState.stories.tsx             |                 6 |
| 13  | ErrorBoundary.tsx                  |                 6 |
| 14  | ErrorBoundary.stories.tsx          |                 1 |
| 15  | LoadingBoundary.tsx                |                 1 |
| 16  | LoadingBoundary.stories.tsx        |                 4 |
| 17  | NetworkSwitcher.tsx                |                 2 |
| 18  | NetworkSwitcher.stories.tsx        |                 0 |
| 19  | ReceiveForm.tsx                    |                10 |
| 20  | ReceiveForm.stories.tsx            |                 0 |
| 21  | SendForm.tsx                       |                23 |
| 22  | SendForm.stories.tsx               |                 0 |
| 23  | Skeleton.tsx                       |                 2 |
| 24  | Skeleton.stories.tsx               |                 0 |
| 25  | SkeletonList.stories.tsx           |                 1 |
| 26  | ThemeToggle.tsx                    |                 3 |
| 27  | ThemeToggle.stories.tsx            |                 0 |
| 28  | TransactionList.tsx                |               ~62 |
| 29  | TransactionList.stories.tsx        |                 0 |
| 30  | TransactionStatusBadge.tsx         |                 3 |
| 31  | TransactionStatusBadge.stories.tsx |                 3 |
| 32  | WalletConnectButton.tsx            |                 8 |
| 33  | WalletConnectButton.stories.tsx    |                 0 |

`EmptyState.tsx` and several `.stories.tsx` files show `0` because they only render
`title`/`description`/`children` props supplied by their _callers_ — the strings show
up under whichever file actually passes the literal in (mostly the `.stories.tsx`
files themselves, or the real usage site elsewhere in the app).

## Top 5 files to convert first

1. **`TransactionList.tsx`** (~62) — by far the largest: the full
   `OPERATION_TYPE_LABELS` map (29 entries), a hand-rolled relative-time formatter,
   empty/error/loading states, pagination controls, CSV export, and a composed
   aria-label sentence. Scope this as its own workstream (see below), not a simple
   find-and-replace.
2. **`SendForm.tsx`** (23) — every field label/placeholder, three validation error
   messages, the fee-bump sponsor help text, and status badge labels.
3. **`ContractCallPreview.tsx`** (13)
4. **`BalanceDisplay.tsx`** (13)
5. **`ContractCallForm.tsx`** (12)

Runners-up: `ReceiveForm.tsx` (10), `WalletConnectButton.tsx` (8).

## Full per-file inventory

### AccountSwitcher.tsx (1)

- `:87` — `"Available Accounts ({accounts.length})"` (label — **needs pluralization**, see below)

### BalanceDisplay.tsx (13)

- `:89` `"Connect wallet to view balances"` (heading)
- `:90` `"Your balances will appear once your wallet is connected"` (description)
- `:112` `"Failed to load balances"` (error)
- `:114` `"An unexpected error occurred."` (error fallback)
- `:121` `"Retry"` (button)
- `:134` `"No balances yet"` (heading)
- `:137` `"This account has no balances. It may still need funding."` (description)
- `:138` `"This account has no balances."` (description)
- `:153` `"Balances"` (heading)
- `:157` `"Refresh balances"` (aria-label)
- `:164` `"Refresh"` (button)
- `:170` `"Native"` (label)
- `:206` `'Failed to refresh balances.'` (error fallback)

### ContractCallForm.tsx (12)

- `:155` `"Call Contract Function"` (heading)
- `:164` `"Function name"` (label)
- `:174` `"e.g. transfer"` (placeholder)
- `:187` `"Arguments"` (label)
- `:190` `"(comma-separated, optional)"` (label, supplementary)
- `:200` `"e.g. GABC…, 1000, true"` (placeholder)
- `:206-209` "Strings, integers, and booleans are auto-detected. For advanced types (u128, bytes, etc.) use the … hook directly." (help text)
- `:220` `'Simulating…'` / `'Preview'` (button, 2 strings)
- `:240` `"Building transaction…"` (status)

### ContractCallPreview.tsx (13)

- `:56` `'(void)'` (rendered result placeholder)
- `:160` `"Simulating contract call…"` (aria-label)
- `:165` `"Simulating transaction…"` (status)
- `:193` `"Simulation failed"` (error heading)
- `:208` `"Go back"` (button)
- `:224` `"Simulation preview"` (aria-label)
- `:227-229` `"Simulation Preview"` (heading)
- `:234` `"Estimated fee"` (label)
- `:239` `"stroops"` (unit label)
- `:248` `"Return value"` (label)
- `:259` `"Simulated at ledger"` (label)
- `:276` `"Cancel"` (button)
- `:284` `"Confirm & Submit"` (button)

### CopyButton.tsx (4)

- `:43` `label = 'text'` (default prop, feeds aria-label)
- `:50` `` `${label} copied to clipboard.` `` (status)
- `:57` `` copied ? `${label} copied` : `Copy ${label}` `` (aria, 2 phrases)

### EmptyState.stories.tsx (6)

- `:17` `"No transactions yet"`
- `:24-25` `"No transactions yet"` / `"Your transaction history will appear here"`
- `:33` `"Connect wallet to view transactions"`
- `:41-42` `"Connect wallet to view balances"` / `"Your XLM and asset balances will appear here once connected."`
- `:45` `"Connect Wallet"` (button)

### ErrorBoundary.tsx (6)

- `:58` `"Something went wrong"` (heading)
- `:61-62` "The app hit an unexpected error while rendering. You can try again to recover." (description)
- `:71` `"Try Again"` (button)
- `:81` `"Hide Details"` / `"Show Details"` (button, 2 strings)
- `:91` `"Error Details"` (heading)
- `:95` `` `\n\nComponent Stack:${...}` `` (label prefix)

### ErrorBoundary.stories.tsx (1)

- `:25` `"Everything is fine — this is the app rendering normally."`

### LoadingBoundary.tsx (1)

- `:29` `label = 'Loading'` (default prop)

### LoadingBoundary.stories.tsx (4)

- `:25` `"Content has loaded."`
- `:34` `'Loading balances'`
- `:42` `'Loading recent activity'`
- `:53` `"Fetching from Horizon…"`

### NetworkSwitcher.tsx (2)

- `:29` `"Switching networks will disconnect your wallet. Continue?"` (native `window.confirm()` text)
- `:61` `"Network"` (label)

Note: `NETWORKS.testnet.name`/`.mainnet.name` come from
`src/templates/default/src/config/networks.ts`, not this file — that config's own
network display names are worth a follow-up check but are out of scope here.

### ReceiveForm.tsx (10)

- `:84` `'Could not generate QR code.'` (error)
- `:113` `'No address available.'` (status)
- `:114` `'Connect your wallet to see your receive address.'` (status)
- `:127` `"Receive Stellar Assets"` (heading)
- `:134` `"QR code of Stellar address"` (aria-label)
- `:141` `` `QR code for Stellar address ${address}` `` (alt text)
- `:153` `"Loading QR code"` (aria-label)
- `:171` `copied ? 'Address copied' : 'Copy address to clipboard'` (aria-label, 2 strings)
- `:180` `"Only send Stellar (XLM) and supported assets to this address."` (help text)

### SendForm.tsx (23)

- `:37` `'Enter a valid Stellar public key (starts with G).'` (error)
- `:42` `'Enter a valid sponsor public key (starts with G).'` (error)
- `:47` `'Enter an amount greater than 0.'` (error)
- `:100` `'Payment failed.'` (error fallback)
- `:110` `"Send Payment"` (heading)
- `:121-128` `'Submitting'` / `'Awaiting sponsor'` / `'Sent'` / `'Failed'` (status badge, 4 strings)
- `:135` `"To"` (label)
- `:142` `"GABC...1234"` (placeholder)
- `:161` `"Asset"` (label)
- `:170` `"XLM (Native)"` (select option)
- `:184` `"Amount ({selectedAsset})"` (label, interpolated)
- `:192` `"0.00"` (placeholder)
- `:210` `"Memo (optional)"` (label)
- `:224` `"Fee Sponsor (optional fee-bump)"` (label)
- `:231` `"GSPONSOR...1234"` (placeholder)
- `:248` `"Connect a wallet to send a payment."` (status)
- `:251-253` `"The connected wallet adapter does not support sending payments."` (status)
- `:269-273` long fee-bump sponsor help text (see source)
- `:278` `"Unsigned fee-bump transaction XDR"` (aria-label)
- `:291` `'Sending…'` / `'Send with Fee-Bump'` / `'Send'` (button, 3 strings)

### Skeleton.tsx (2)

- `:68` `label = 'Loading'` (default prop)
- `:76` `` `${label}...` `` (sr-only status text)

### SkeletonList.stories.tsx (1)

- `:24` `'Loading transaction history'`

### ThemeToggle.tsx (3)

- `:7-9` `'Light'` / `'Dark'` / `'System'` (labels)
- `:29` `"Theme"` (aria-label)

### TransactionList.tsx (~62)

- `:95-128` `OPERATION_TYPE_LABELS` map — 29 entries: `Payment`, `Create Account`,
  `Account Merge`, `Account Deleted`, `Allow Trust`, `Bump Sequence`,
  `Begin Sponsoring`, `Change Trust`, `Claim Balance`, `Clawback`,
  `Clawback Balance`, `Create Claimable Balance`, `Passive Sell Offer`,
  `End Sponsoring`, `Extend TTL`, `Inflation`, `Contract Call`, `Buy Offer`,
  `Manage Data`, `Sell Offer`, `Path Payment`, `Revoke Sponsorship`,
  `Set Options`, `Set Trust Line Flags`, `LP Deposit`, `LP Withdraw`,
  `Restore Footprint`, `Smart Account`, `Sponsor`, `Sponsor Reserves`,
  `Bump Expiration`
- `:139` `'Unknown'` (address fallback)
- `:155,158` `'just now'` (x2 — **needs `Intl.RelativeTimeFormat`**)
- `:161,164,167,170,173` `` `${n}m/h/d/mo/y ago` `` (**needs pluralization + number formatting**)
- `:190,192` `'XLM'` (asset code fallback, x2)
- `:227,232,276` `'Failed'` / `'Success'` (status, 3 occurrences)
- `:342` `"Loading transaction history"` (aria-label)
- `:353` `"Failed to load transactions"` (error)
- `:356` `'An unexpected error occurred.'` (error fallback)
- `:363,401` `"Retry"` (button, x2)
- `:374` `'No transactions yet'` / `'Connect wallet to view transactions'` (heading, x2)
- `:376-378` `'Your transaction history will appear here'` / `'Your transactions will appear once your wallet is connected'` (description, x2)
- `:395` `'Failed to load more transactions.'` (error fallback)
- `:411` `"Export transactions to CSV"` (aria-label)
- `:414` `"Export CSV"` (button)
- `:421` `"Transaction history"` (aria-label)
- `:440-442` composed aria-label sentence (`Received`/`Sent` + type + amount + counterparty + time + status — **needs ICU MessageFormat-style templating, not concatenation**)
- `:461` `'Loading more transactions'` / `'Load more transactions'` (aria-label, x2)
- `:466` `"Loading..."` (button)
- `:472` `"Load More"` (button)

### TransactionStatusBadge.tsx (3)

- `:68,73,78` `'Pending'` / `'Success'` / `'Failed'` (status)

### TransactionStatusBadge.stories.tsx (3)

- `:36,63` `'Awaiting signature'` (custom override, x2)
- `:73` `'Confirmed'` (custom override)

### WalletConnectButton.tsx (8)

- `:59` `` `Disconnect ${walletName ?? 'wallet'}` `` (aria-label)
- `:60` `'Connect Stellar wallet'` (aria-label)
- `:78` `'Disconnecting...'` / `'Connecting...'` (button, x2)
- `:79` `` `Disconnect ${walletName}` `` (button)
- `:80` `'Connect Wallet'` (button)
- `:94` `` `${actionLabel} in progress` `` (aria-label)
- `:113,115` `'Refresh balances'` (aria + title, same string x2)

## Strings needing special i18n handling

These can't be solved with a plain `t('key')` lookup — they need
`Intl.RelativeTimeFormat`, `Intl.PluralRules`, or ICU MessageFormat-style
plural/interpolation support once a real catalog format is adopted:

1. **`TransactionList.tsx`'s `relativeTime()` function** (`'just now'`,
   `${n}m/h/d/mo/y ago`) — a hand-rolled relative-time formatter. Needs full
   replacement with `Intl.RelativeTimeFormat` (which handles per-locale
   pluralization itself) rather than simple string substitution — abbreviated units
   like `"mo"`/`"h"` aren't universal across locales, and "1 minute ago" vs
   "2 minutes ago" needs real plural rules that don't exist in this abbreviated form.
2. **`AccountSwitcher.tsx`'s `"Available Accounts ({accounts.length})"`** — a
   count-dependent heading needs pluralization ("1 Account" vs "2 Accounts") once
   translated into a language that pluralizes differently than English.
3. **Numeric formatting is already partly locale-aware** — `BalanceDisplay.tsx`'s
   `formatBalance` and `TransactionList.tsx`'s `formatAmount` already use
   `toLocaleString`, which is good practice, but the surrounding unit/label text
   ("XLM", "Native") is still hardcoded, not parameterized.
4. **`TransactionList.tsx`'s composed aria-label sentence** (line 440-442) —
   concatenates several hardcoded fragments (`'Received'`/`'Sent'`, `' of '`,
   `' with '`, `' status '`) around dynamic values. Word order and prepositions vary
   by language; literal concatenation of separately-translated fragments will
   produce grammatically broken sentences in many target languages. This needs one
   translatable sentence template with placeholders (ICU MessageFormat-style), not
   string concatenation.
5. **Parameterized interpolation, not concatenation** — `WalletConnectButton.tsx`
   (`` `Disconnect ${walletName}` ``) and `CopyButton.tsx`
   (`` `${label} copied` ``) both interpolate a value into a sentence. These need
   `t('key', { name })`-style parameterized keys so translators can reorder the
   sentence around the placeholder, not string concatenation.

## Recommended extraction order

1. **Wire `I18nProvider` into `layout.tsx`** first (currently opt-in) — converting
   components to call `t(...)` has no visible effect until the provider is in the
   tree.
2. **Small, self-contained files first** to validate the pattern:
   `ThemeToggle.tsx`, `TransactionStatusBadge.tsx`, `CopyButton.tsx`,
   `NetworkSwitcher.tsx`, `Skeleton.tsx`/`LoadingBoundary.tsx`.
3. **Mid-size forms**: `BalanceDisplay.tsx`, `ContractCallForm.tsx`,
   `ContractCallPreview.tsx`, `ReceiveForm.tsx`, `WalletConnectButton.tsx`.
4. **`SendForm.tsx`** — largest form, several validation/status messages.
5. **`TransactionList.tsx` as its own workstream** — the operation-type label map
   is a straightforward key-per-entry conversion, but `relativeTime()` and the
   composed aria-label sentence need actual logic changes (see above), not just
   string extraction. Budget this file separately from the rest.

## Catching new hardcoded strings going forward

See `scripts/check-hardcoded-jsx-text.mjs` and the `npm run lint:i18n` script it's
wired to (documented in that script's own header comment). It's a lightweight,
repo-specific static check — not a full i18n linter — that flags new hardcoded JSX
text content and common text-bearing props (`aria-label`, `placeholder`, `title`,
`alt`) added to `src/templates/default/src/components/` going forward, so this
inventory doesn't silently grow stale. It is not wired into `ci.yml` as a required
check in this PR (see the script's header for why and what a follow-up would need).
