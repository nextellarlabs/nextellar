export type AssetDirectoryEntry = {
  code: string;
  issuer: string;
  name: string;
  trustCount: number;
};

const DIRECTORY_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6;

const curatedAssets: AssetDirectoryEntry[] = [
  { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", name: "USD Coin", trustCount: 4200000 },
  { code: "USDT", issuer: "GBVCKBOOQG2YAAW2GQH2CBEB4X3YQBCJCULSJHGQXGMAQF3OQ2KE2Y4U", name: "Tether USD", trustCount: 3900000 },
  { code: "XLM", issuer: "native", name: "Stellar Lumens", trustCount: 3700000 },
  { code: "BTC", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "Bitcoin", trustCount: 1800000 },
  { code: "ETH", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "Ethereum", trustCount: 1500000 },
  { code: "EURC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", name: "Euro Coin", trustCount: 1100000 },
  { code: "SOL", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "Solana", trustCount: 900000 },
  { code: "ADA", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "Cardano", trustCount: 800000 },
  { code: "DOGE", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "Dogecoin", trustCount: 700000 },
  { code: "XML", issuer: "GB7T7YH4W2H2C3S3F2FWQ5G4FQW5X2Q2VQ4Y4Q2YQJSG2I4G72Q5M7J", name: "XML Coin", trustCount: 100000 },
];

let cachedAssets: AssetDirectoryEntry[] | null = null;
let lastRefreshAt = 0;

function cloneAssets(assets: AssetDirectoryEntry[]): AssetDirectoryEntry[] {
  return assets.map((asset) => ({ ...asset }));
}

function sortAssets(assets: AssetDirectoryEntry[]): AssetDirectoryEntry[] {
  return [...assets].sort((left, right) => {
    if (right.trustCount !== left.trustCount) {
      return right.trustCount - left.trustCount;
    }

    return left.code.localeCompare(right.code);
  });
}

export function refreshAssetDirectory(force = false): AssetDirectoryEntry[] {
  const now = Date.now();
  if (!force && cachedAssets && now - lastRefreshAt < DIRECTORY_REFRESH_INTERVAL_MS) {
    return cloneAssets(cachedAssets);
  }

  cachedAssets = sortAssets(curatedAssets);
  lastRefreshAt = now;
  return cloneAssets(cachedAssets);
}

export function searchAssetDirectory(query: string, limit = 10): AssetDirectoryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const assets = refreshAssetDirectory();

  if (!normalizedQuery) {
    return assets.slice(0, limit);
  }

  const scored = assets
    .map((asset) => {
      const normalizedCode = asset.code.toLowerCase();
      let score = 0;

      if (normalizedCode === normalizedQuery) {
        score = 1000 + asset.trustCount;
      } else if (normalizedCode.startsWith(normalizedQuery)) {
        score = 500 + asset.trustCount;
      } else if (normalizedCode.includes(normalizedQuery)) {
        score = 100 + asset.trustCount;
      } else {
        return null;
      }

      return { asset, score };
    })
    .filter((entry): entry is { asset: AssetDirectoryEntry; score: number } => entry !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.asset.trustCount !== left.asset.trustCount) {
        return right.asset.trustCount - left.asset.trustCount;
      }

      return left.asset.code.localeCompare(right.asset.code);
    });

  return scored.slice(0, limit).map((entry) => ({ ...entry.asset }));
}
