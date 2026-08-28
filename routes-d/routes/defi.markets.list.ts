import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type MarketAsset = {
  code: string;
  issuer: string;
};

type Market = {
  id: string;
  baseAsset: MarketAsset;
  counterAsset: MarketAsset;
  baseVolume24h: string;
  counterVolume24h: string;
  tradeCount24h: number;
  open: string;
  high: string;
  low: string;
  close: string;
  change24h: string;
};

const DEFAULT_MARKETS: Market[] = [
  {
    id: "USDC-XLM",
    baseAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "2500000.00",
    counterVolume24h: "125000000.00",
    tradeCount24h: 4320,
    open: "0.0200",
    high: "0.0210",
    low: "0.0195",
    close: "0.0205",
    change24h: "2.50",
  },
  {
    id: "BTC-XLM",
    baseAsset: { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "85.00",
    counterVolume24h: "17000000.00",
    tradeCount24h: 890,
    open: "190000.0000",
    high: "205000.0000",
    low: "188000.0000",
    close: "200000.0000",
    change24h: "5.26",
  },
  {
    id: "USDT-XLM",
    baseAsset: { code: "USDT", issuer: "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53NMYVOZ3A7EKV68" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "980000.00",
    counterVolume24h: "49000000.00",
    tradeCount24h: 1760,
    open: "0.0199",
    high: "0.0208",
    low: "0.0197",
    close: "0.0202",
    change24h: "1.51",
  },
  {
    id: "ETH-XLM",
    baseAsset: { code: "ETH", issuer: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "420.00",
    counterVolume24h: "13440000.00",
    tradeCount24h: 610,
    open: "31000.0000",
    high: "33000.0000",
    low: "30500.0000",
    close: "32000.0000",
    change24h: "3.23",
  },
];

const CACHE_TTL_MS = 10_000;

let marketsStore: Market[] = [...DEFAULT_MARKETS];
let cachedMarkets: Market[] | null = null;
let cacheTimestamp = 0;

export function __resetMarketsListCache(): void {
  cachedMarkets = null;
  cacheTimestamp = 0;
  marketsStore = [...DEFAULT_MARKETS];
}

export function __seedMarketsList(markets: Market[]): void {
  marketsStore = markets;
  cachedMarkets = null;
  cacheTimestamp = 0;
}

function rankByVolume(list: Market[]): Market[] {
  return [...list].sort(
    (a, b) => parseFloat(b.baseVolume24h) - parseFloat(a.baseVolume24h),
  );
}

router.get("/defi/markets", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assetFilter =
      typeof req.query.asset === "string" ? req.query.asset.toUpperCase() : null;

    const now = Date.now();
    let allMarkets: Market[];
    let fromCache: boolean;

    if (cachedMarkets && now - cacheTimestamp < CACHE_TTL_MS) {
      allMarkets = cachedMarkets;
      fromCache = true;
    } else {
      allMarkets = marketsStore.map((m) => ({ ...m }));
      cachedMarkets = allMarkets;
      cacheTimestamp = now;
      fromCache = false;
    }

    const filtered = assetFilter
      ? allMarkets.filter(
          (m) =>
            m.baseAsset.code.toUpperCase() === assetFilter ||
            m.counterAsset.code.toUpperCase() === assetFilter,
        )
      : allMarkets;

    if (assetFilter !== null && filtered.length === 0) {
      return res.status(200).json({
        success: true,
        data: { markets: [], fromCache },
      });
    }

    const ranked = rankByVolume(filtered);

    return res.status(200).json({
      success: true,
      data: { markets: ranked, fromCache },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
