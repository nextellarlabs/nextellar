import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

const router = Router();

const DEFAULT_TIMEOUT_MS = 5_000;

export type ExchangeRatePayload = {
  base: string;
  quote: string;
  rate: number;
};

function readExchangeRateTimeoutMs(): number {
  const rawTimeout = process.env.EXCHANGE_RATE_TIMEOUT_MS;
  if (!rawTimeout) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(rawTimeout);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.floor(parsed);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "AbortError";
  }
  return false;
}

export async function fetchExchangeRateFromUpstream(
  base: string,
  quote: string,
  signal: AbortSignal,
): Promise<ExchangeRatePayload> {
  const upstreamUrl = new URL(
    process.env.EXCHANGE_RATE_API_URL ??
      "https://api.exchangerate.host/convert",
  );
  upstreamUrl.searchParams.set("from", base);
  upstreamUrl.searchParams.set("to", quote);

  const response = await fetch(upstreamUrl.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Upstream exchange rate request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    result?: number;
    info?: { rate?: number };
    rate?: number;
  };
  const upstreamRate =
    typeof payload.result === "number"
      ? payload.result
      : typeof payload.info?.rate === "number"
        ? payload.info.rate
        : payload.rate;

  if (typeof upstreamRate !== "number") {
    throw new Error("Upstream exchange rate response is missing numeric rate");
  }

  return { base, quote, rate: upstreamRate };
}

router.get(
  "/exchange-rate",
  async (req: Request, res: Response, next: NextFunction) => {
    const base =
      typeof req.query.base === "string" ? req.query.base.toUpperCase() : "XLM";
    const quote =
      typeof req.query.quote === "string"
        ? req.query.quote.toUpperCase()
        : "USD";
    const timeoutMs = readExchangeRateTimeoutMs();

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const exchangeRate = await fetchExchangeRateFromUpstream(
        base,
        quote,
        controller.signal,
      );
      return res.status(200).json({ success: true, data: exchangeRate });
    } catch (err) {
      if (isAbortError(err)) {
        sendError(res, 'UPSTREAM_TIMEOUT', 'Upstream exchange rate request timed out', 504);
        return;
      }
      return next(err);
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
);

export default router;
