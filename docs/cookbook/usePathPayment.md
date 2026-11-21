# Cookbook: Path Payments (`usePathPayment`)

The `usePathPayment` hook (available in the `defi` template) executes Stellar DEX swaps and cross-asset payments via Horizon path finding, building `pathPaymentStrictSend` or `pathPaymentStrictReceive` transactions with stroop-exact slippage bounds.

---

## Overview

Use `usePathPayment` and the helpers in `src/lib/pathPayment.ts` when your app needs to:

- Discover multi-hop conversion routes (`findPaths`, `findBestPath`, `describePath`).
- Fix the **send amount** (`strict-send`) and guard the minimum received (`minReceiveAmount`).
- Fix the **receive amount** (`strict-receive`) and cap the maximum spent (`maxSendAmount`).
- Build an unsigned XDR for wallet signing (`buildPathPaymentXDR`) and submit it (`submitSignedXDR`).

---

## Strict-Send vs Strict-Receive

| Mode             | Fixed Amount              | Slippage Protection            | Best Route Selection              |
| ---------------- | ------------------------- | ------------------------------ | --------------------------------- |
| `strict-send`    | `quote.sourceAmount`      | `destMin = minReceiveAmount()` | Highest `quote.destinationAmount` |
| `strict-receive` | `quote.destinationAmount` | `sendMax = maxSendAmount()`    | Lowest `quote.sourceAmount`       |

Slippage is passed as `slippageBps` (basis points, `0–5000`; defaults to `DEFAULT_SLIPPAGE_BPS = 100`, i.e. `1%`).

---

## Worked Example (Quote, Preview Route & Submit)

```tsx
import { useState } from "react";
import { usePathPayment } from "../hooks/usePathPayment";
import {
  DEFAULT_SLIPPAGE_BPS,
  describePath,
  minReceiveAmount,
  maxSendAmount,
  type PathPaymentMode,
  type PathQuote,
  type SwapAsset,
} from "../lib/pathPayment";

const USDC: SwapAsset = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

export function SwapPanel({
  account,
  signXdr,
}: {
  account: string;
  signXdr: (xdr: string) => Promise<string>;
}) {
  const { findBestPath, buildPathPaymentXDR, submitSignedXDR } = usePathPayment(
    {
      network: "TESTNET",
    },
  );
  const [mode, setMode] = useState<PathPaymentMode>("strict-send");
  const [amount, setAmount] = useState("10");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<PathQuote | null>(null);
  const [status, setStatus] = useState("");

  const handleQuote = async () => {
    setStatus("");
    const best = await findBestPath({
      mode,
      sourceAsset: "XLM",
      destinationAsset: USDC,
      amount,
    });
    if (!best) {
      setStatus("No conversion route found for this pair.");
      return;
    }
    setQuote(best);
  };

  const handleSwap = async () => {
    if (!quote) return;
    try {
      const unsignedXdr = await buildPathPaymentXDR({
        mode,
        from: account,
        quote,
        slippageBps,
      });
      const signedXdr = await signXdr(unsignedXdr);
      const res = await submitSignedXDR(signedXdr);
      if (!res.success) {
        const codes = res.resultCodes?.operations?.join(", ");
        setStatus(
          codes ? `${res.error} (${codes})` : (res.error ?? "Swap failed"),
        );
        return;
      }
      setStatus(`Confirmed: ${res.txHash}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unexpected swap error");
    }
  };

  return (
    <div className="space-y-3">
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as PathPaymentMode)}
      >
        <option value="strict-send">Strict Send (fix spend)</option>
        <option value="strict-receive">Strict Receive (fix output)</option>
      </select>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input
        type="number"
        min={0}
        max={5000}
        value={slippageBps}
        onChange={(e) => setSlippageBps(Number(e.target.value))}
      />
      <button onClick={handleQuote}>Find Route</button>

      {quote && (
        <div>
          <p>Route: {describePath(quote)}</p>
          <p>
            {mode === "strict-send"
              ? `Min received: ${minReceiveAmount(quote.destinationAmount, slippageBps)} USDC`
              : `Max spent: ${maxSendAmount(quote.sourceAmount, slippageBps)} XLM`}
          </p>
          <button onClick={handleSwap}>Swap</button>
        </div>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}
```

---

## Error Handling & Best Practices

1. **No Path Found (`null`)**: `findBestPath` returns `null` when Horizon returns zero routes; prompt the user to adjust amount or pair instead of calling `buildPathPaymentXDR`.
2. **Invalid Amounts & Slippage**: `findPaths` validates `amount` up to 7 decimal places (`isValidAmount`), and `minReceiveAmount`/`maxSendAmount` reject non-integer or out-of-range `slippageBps` (`0–5000`) before any network request.
3. **Horizon & Result Codes**:
   - `buildPathPaymentXDR` throws a clear error for `404` unfunded sender accounts and `5xx` Horizon errors.
   - `submitSignedXDR` returns `{ success: false, error, resultCodes }` on failed transactions (for example `op_under_dest_min` or `op_over_send_max` when price moves past your slippage bound).
4. **Separate Recipient**: Pass `to` in `buildPathPaymentXDR({ mode, from, to, quote })` to pay another account in a different asset rather than swapping to `from`.
