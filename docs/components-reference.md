# Components Reference

Every Nextellar template ships a set of production-ready React components under
`src/components`. They are built with Tailwind CSS, fully typed (`.tsx` in the
TypeScript templates, `.jsx` in the JavaScript ones), and accessible by default
(status is conveyed by text + icon, not colour alone).

This page documents **all components shipped in the default (TypeScript)
template**. The JavaScript templates ship the same components as `.jsx` files
with identical props.

All components are imported from `@/components/...` (or
`../components/...` from within the app):

```tsx
import WalletConnectButton from '@/components/WalletConnectButton';
```

---

## WalletConnectButton

`'use client'`. The primary call-to-action for wallet connectivity. Connects or
disconnects the active Stellar wallet and, once connected, renders the
`AccountSwitcher` so the user can hop between multiple accounts.

| Prop   | Type                 | Default  | Description                              |
| ------ | -------------------- | -------- | ---------------------------------------- |
| theme  | `'light' \| 'dark'`  | `'light'`| Colour scheme of the button.             |

```tsx
<WalletConnectButton theme="dark" />
```

---

## AccountSwitcher

`'use client'`. A dropdown listing every connected account, with the active
account marked. Used inside `WalletConnectButton` once a wallet is connected.
Renders nothing when no account is connected.

No props. Reads state from `useWallet()`.

---

## NetworkSwitcher

`'use client'`. Lets the user switch between `testnet` and `mainnet`. Warns and
disconnects the wallet before switching networks. Renders nothing when the
active template has network switching disabled.

No props. Reads config from `useWalletConfig()` and `useWallet()`.

---

## ThemeToggle

`'use client'`. A three-way `light` / `dark` / `system` switcher backed by
`useTheme()`. Must be rendered inside a `ThemeProvider`.

No props.

```tsx
<ThemeProvider>
  <ThemeToggle />
</ThemeProvider>
```

---

## TransactionList

`'use client'`. Renders the connected account's operation/payment history with
pagination, loading skeletons, error and empty states. Built on top of
`useTransactionHistory`, `SkeletonList`, and `EmptyState`.

| Prop   | Type                        | Default | Description                                          |
| ------ | --------------------------- | ------- | ---------------------------------------------------- |
| limit  | `number`                    | `10`    | Page size passed to `useTransactionHistory`.         |
| type   | `'payments' \| 'operations'`| —       | Feed kind; defaults to `operations` in the hook.     |

```tsx
<TransactionList limit={20} type="payments" />
```

---

## TransactionStatusBadge

`'use client'`. A small pill reporting a transaction's lifecycle state. Status
is communicated through colour **and** a distinct icon + text label, so it stays
legible for colour-blind users and in monochrome.

| Prop         | Type                                                  | Default     | Description                                                  |
| ------------ | ----------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| status       | `'pending' \| 'success' \| 'failed'`                  | — (required)| State to display.                                            |
| label        | `string`                                              | per-status  | Overrides the default text (e.g. "Awaiting signature").      |
| className    | `string`                                              | `''`        | Extra classes merged onto the badge root.                    |
| showSpinner  | `boolean`                                             | `true`      | Animate a spinner in the `pending` state (ignored otherwise).|

```tsx
<TransactionStatusBadge status="success" label="Confirmed" />
```

---

## EmptyState

A generic empty-state block for lists / balances with nothing to show.

| Prop         | Type            | Default        | Description                                            |
| ------------ | --------------- | -------------- | ------------------------------------------------------ |
| icon         | `ReactNode`     | inbox icon     | Icon shown above the message.                          |
| title        | `string`        | — (required)   | Primary message.                                       |
| description  | `string`        | —              | Supporting copy beneath the title.                     |
| action       | `ReactNode`     | —              | Optional action (e.g. a "Connect Wallet" button).     |

Also exports `NoWalletIcon` for the "wallet not connected" flavour:

```tsx
import EmptyState, { NoWalletIcon } from '@/components/EmptyState';

<EmptyState icon={<NoWalletIcon />} title="Connect wallet to view balances" />
```

---

## LoadingBoundary

Wraps an async data view (a Server Component reading from Horizon, or a client
component suspending on a data-fetching hook) in a `<Suspense>` boundary with a
layout-stable skeleton fallback, preventing layout shift once content resolves.

| Prop      | Type            | Default     | Description                                              |
| --------- | --------------- | ----------- | -------------------------------------------------------- |
| children  | `ReactNode`     | — (required)| The async view to render.                                |
| label     | `string`        | `'Loading'` | Screen-reader label for the fallback region.             |
| rows      | `number`        | `4`         | Skeleton rows when no `fallback` is given.               |
| fallback  | `ReactNode`     | `SkeletonList` | Custom fallback UI.                                  |

```tsx
<LoadingBoundary label="Loading balances" rows={3}>
  <BalanceList />
</LoadingBoundary>
```

---

## Skeleton

Low-level loading placeholders. Exports `Skeleton` (a single pulsing block) and
`SkeletonList` (a stack of rows). Both reserve the exact space the final content
occupies to avoid layout shift.

### `Skeleton`

| Prop       | Type      | Default    | Description                              |
| ---------- | --------- | ---------- | ---------------------------------------- |
| width      | `string`  | `'w-full'`| Tailwind width class (e.g. `"w-28"`).    |
| height     | `string`  | `'h-4'`   | Tailwind height class (e.g. `"h-10"`).   |
| className  | `string`  | `''`      | Extra classes (e.g. `"rounded-full"`).   |

### `SkeletonList`

| Prop       | Type                          | Default     | Description                               |
| ---------- | ----------------------------- | ----------- | ----------------------------------------- |
| rows       | `number`                      | `4`         | Number of skeleton rows.                   |
| label      | `string`                      | `'Loading'` | Accessible loading label.                 |
| renderRow  | `(index: number) => ReactNode`| generic row | Custom skeleton shape per row.            |

```tsx
<Skeleton width="w-10" height="h-10" className="rounded-full" />
<SkeletonList rows={4} label="Loading transaction history" />
```

---

## ErrorBoundary

`'use client'`. A class-based React error boundary that catches render errors
and shows a recoverable "Something went wrong" screen with an optional
collapsible error-detail panel. Wrap your app (or risky subtrees) in it.

| Prop      | Type        | Default     | Description                  |
| --------- | ----------- | ----------- | ---------------------------- |
| children  | `ReactNode` | — (required)| The tree to guard.           |

```tsx
<ErrorBoundary>
  <App />
</ErrorBoundary>
```
