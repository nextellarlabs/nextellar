# Cookbook: `useStellarPayment`

The `useStellarPayment` hook streamlines sending Stellar native payments (XLM) and asset transfers (USDC, SAC tokens) with automatic transaction envelope building, signing, and Horizon submission.

---

## Overview

Use `useStellarPayment` when your application needs to:
- Send XLM tips or direct payments.
- Transfer custom Stellar assets or stablecoins (e.g. USDC).
- Track payment execution stages (`submitting`, `confirmed`, `failed`).
- Handle path payments or asset conversion.

---

## Basic Usage

```tsx
import { useState } from 'react';
import { useStellarPayment } from 'nextellar/hooks';

function PaymentForm({ destinationAddress }: { destinationAddress: string }) {
  const { sendPayment, status, error, txHash } = useStellarPayment();
  const [amount, setAmount] = useState('10');

  const handleSend = async () => {
    await sendPayment({
      destination: destinationAddress,
      amount,
      asset: 'native', // XLM payment
      memo: 'SupportMe Tip',
    });
  };

  return (
    <div className="space-y-4">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount in XLM"
      />
      <button
        onClick={handleSend}
        disabled={status === 'submitting'}
        className="btn-primary"
      >
        {status === 'submitting' ? 'Submitting...' : 'Send XLM'}
      </button>

      {txHash && (
        <p className="text-green-600">
          Payment confirmed! Tx: <a href={`https://stellar.expert/explorer/public/tx/${txHash}`}>{txHash.slice(0, 8)}...</a>
        </p>
      )}
      {error && <p className="text-red-600">Payment failed: {error.message}</p>}
    </div>
  );
}
```

---

## Custom Asset Transfers (e.g., USDC)

```tsx
const sendUsdc = async () => {
  await sendPayment({
    destination: destinationAddress,
    amount: '5.00',
    asset: {
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5XYKG4CA62VU722VJ4EBUUXQLTFJOHTXELAH',
    },
  });
};
```

---

## Best Practices & Tips

1. **Memo Validation**: Limit text memos to 28 bytes per Stellar Horizon limits.
2. **Trustline Preflight**: Check recipient trustlines with `useTrustlines` before attempting non-native asset transfers.
3. **Status Polling**: Utilize the built-in `txHash` and `status` variables to render confirmation UI indicators.
