import { fetchStellarToml, type StellarTomlData } from './sep1';

export interface AssetMetadata {
  code: string;
  issuer: string;
  name?: string;
  image?: string;
  verified: boolean;
}

/** Resolve an issued asset from SEP-1, returning a safe code/issuer fallback. */
export async function resolveAssetMetadata(code: string, issuer: string, domain: string): Promise<AssetMetadata> {
  const fallback = { code, issuer, verified: false } satisfies AssetMetadata;
  try {
    const toml = await fetchStellarToml(domain);
    const currencies = (toml as StellarTomlData & { CURRENCIES?: Array<Record<string, unknown>> }).CURRENCIES ?? [];
    const asset = currencies.find((entry) => entry.code === code && entry.issuer === issuer);
    if (!asset) return fallback;
    return {
      ...fallback,
      name: typeof asset.name === 'string' ? asset.name : undefined,
      image: typeof asset.image === 'string' ? asset.image : undefined,
      verified: asset.status === 'live' || asset.issuer === issuer,
    };
  } catch {
    return fallback;
  }
}
