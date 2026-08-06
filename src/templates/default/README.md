# {{APP_NAME}}

This is a [Next.js 16](https://nextjs.org) project bootstrapped with [Nextellar](https://github.com/nextellarlabs/nextellar) - a Stellar blockchain dApp starter using **Tailwind CSS v4**.

> ✨ **Congratulations!** You've successfully created a Nextellar project. When you scaffolded this app, you saw our friendly success animation and ASCII logo - that's how we celebrate your new Stellar dApp journey!

## 🌟 Stellar Integration

This template includes pre-built Stellar blockchain integration:

- **🔗 Wallet Connection**: `useStellarWallet` hook with Freighter wallet support
- **💰 Balance Display**: Real-time XLM and asset balance fetching
- **🎨 UI Components**: Ready-to-use `WalletConnectButton` and `TransactionList` components
- **📜 Transaction History**: `TransactionList` component powered by `useTransactionHistory` hook
- **🌐 Testnet Ready**: Pre-configured for Stellar testnet development

### Quick Stellar Setup

1. **Install Freighter Wallet**: [Get Freighter](https://www.freighter.app/) browser extension
2. **Create Testnet Account**: Use [Stellar Laboratory](https://laboratory.stellar.org/#account-creator)
3. **Fund with Testnet XLM**: Use the [Friendbot](https://laboratory.stellar.org/#account-creator)

### Usage Example

```tsx
import WalletConnectButton from "@/components/WalletConnectButton";
import { useStellarWallet } from "@/hooks/useStellarWallet";

export default function MyDApp() {
  const { connected, publicKey, balances } = useStellarWallet();

  return (
    <div className="p-8">
      <WalletConnectButton />

      {connected && (
        <div className="mt-4">
          <p>Connected: {publicKey}</p>
          <p>Balance: {balances[0]?.balance} XLM</p>
        </div>
      )}
    </div>
  );
}
```

### 🎨 UI Components

The template includes minimal shadcn/ui-inspired components built inline. You can:

1. **Use as-is** - Components work perfectly out of the box
2. **Upgrade to full shadcn/ui**:

   ```bash
   npx shadcn-ui@latest init
   npx shadcn-ui@latest add button dropdown-menu
   ```

   Then replace the inline components in `WalletConnectButton.tsx`

3. **Use your preferred UI library** - Easily swap out Button/Dropdown components

### 📜 TransactionList Component

The `TransactionList` component displays paginated Stellar transaction history using the `useTransactionHistory` hook. It renders transaction rows with direction indicators, operation type labels, amounts, counterparty addresses, relative timestamps, and transaction status.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | `number` | `10` | Number of transactions per page (passed as `pageSize` to `useTransactionHistory`) |
| `type` | `'payments' \| 'operations'` | `undefined` | Type of history to fetch (defaults to `'operations'` per the hook's default) |

#### Usage Example

```tsx
import TransactionList from "@/components/TransactionList";

export default function HistoryPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">Transaction History</h2>
      <TransactionList limit={10} type="payments" />
    </div>
  );
}
```

The component automatically integrates with the wallet context. When no wallet is connected, it displays a message prompting the user to connect.

### ⚠️ Development vs Production

**Development Mode:**

- Includes `connectWithSecret()` for testing with secret keys
- Shows dev-only UI when Freighter is not available
- **Never use real secret keys - testnet only!**

**Production Mode:**

- Remove all `connectWithSecret` usage
- Implement proper external wallet signing
- Add error handling for wallet connection failures

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
