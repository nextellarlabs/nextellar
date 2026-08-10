export type WindowSize = "24h" | "7d" | "30d";

export type Trade = {
  id: string;
  asset: string;
  amount: number;
  price: number;
  timestamp: Date;
};

export type VolumeEntry = {
  asset: string;
  volume: number;
  tradeCount: number;
  lastPrice: number;
};

export type TopAssetsResult = {
  window: WindowSize;
  generatedAt: Date;
  assets: VolumeEntry[];
};

const trades: Trade[] = [];
const cache = new Map<string, { result: TopAssetsResult; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function windowMs(window: WindowSize): number {
  switch (window) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function cacheKey(window: WindowSize): string {
  return `top:${window}`;
}

export function recordTrade(trade: Trade): void {
  trades.push(trade);
  cache.clear();
}

export function getTopAssets(window: WindowSize): TopAssetsResult {
  const key = cacheKey(window);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.result, generatedAt: new Date(cached.result.generatedAt) };
  }

  const cutoff = new Date(Date.now() - windowMs(window));
  const filtered = trades.filter((t) => t.timestamp >= cutoff);

  const volumeMap = new Map<
    string,
    { volume: number; tradeCount: number; lastPrice: number; lastTimestamp: Date }
  >();

  for (const t of filtered) {
    const prev = volumeMap.get(t.asset);
    const lastPrice =
      prev !== undefined && prev.lastTimestamp.getTime() >= t.timestamp.getTime()
        ? prev.lastPrice
        : t.price;
    const lastTimestamp =
      prev !== undefined && prev.lastTimestamp.getTime() >= t.timestamp.getTime()
        ? prev.lastTimestamp
        : t.timestamp;
    volumeMap.set(t.asset, {
      volume: (prev?.volume ?? 0) + t.amount * t.price,
      tradeCount: (prev?.tradeCount ?? 0) + 1,
      lastPrice,
      lastTimestamp,
    });
  }

  const assets: VolumeEntry[] = Array.from(volumeMap.entries())
    .map(([asset, data]) => ({
      asset,
      volume: data.volume,
      tradeCount: data.tradeCount,
      lastPrice: data.lastPrice,
    }))
    .sort((a, b) => b.volume - a.volume);

  const result: TopAssetsResult = {
    window,
    generatedAt: new Date(),
    assets,
  };

  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

export function __resetTrades(): void {
  trades.length = 0;
  cache.clear();
}

export function __seedTrade(trade: Trade): void {
  trades.push(trade);
}

export function __clearCache(): void {
  cache.clear();
}

export function __getCacheSize(): number {
  return cache.size;
}
