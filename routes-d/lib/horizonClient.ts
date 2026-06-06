export interface HorizonFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type HorizonFetcher = (url: string) => Promise<HorizonFetchResponse>;

export interface HorizonClientOptions {
  primaryUrl?: string;
  fallbackUrl?: string;
  timeoutMs?: number;
  fetcher?: HorizonFetcher;
  onFailover?: (event: HorizonFailoverEvent) => void;
}

export interface HorizonFailoverEvent {
  type: "horizon.failover";
  primaryUrl: string;
  fallbackUrl: string;
  reason: string;
  at: string;
}

export interface HorizonClient {
  getJson<T = unknown>(path: string): Promise<T>;
  lastEndpointUsed(): "primary" | "fallback";
}

const defaultFetcher: HorizonFetcher = async (url) => {
  const resp = await fetch(url);
  return {
    ok: resp.ok,
    status: resp.status,
    json: () => resp.json() as Promise<unknown>,
  };
};

function resolvePrimaryUrl(): string {
  return (process.env.HORIZON_URL ?? process.env.HORIZON_PRIMARY_URL ?? "https://horizon-testnet.stellar.org").replace(
    /\/+$/u,
    "",
  );
}

function resolveFallbackUrl(): string | undefined {
  const url = process.env.HORIZON_FALLBACK_URL;
  return url ? url.replace(/\/+$/u, "") : undefined;
}

function joinUrl(base: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

async function fetchWithTimeout(
  fetcher: HorizonFetcher,
  url: string,
  timeoutMs: number,
): Promise<HorizonFetchResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createHorizonClient(options: HorizonClientOptions = {}): HorizonClient {
  const primaryUrl = (options.primaryUrl ?? resolvePrimaryUrl()).replace(/\/+$/u, "");
  const fallbackUrl = (options.fallbackUrl ?? resolveFallbackUrl())?.replace(/\/+$/u, "");
  const timeoutMs = options.timeoutMs ?? Number(process.env.HORIZON_TIMEOUT_MS ?? 5_000);
  const fetcher = options.fetcher ?? defaultFetcher;
  const onFailover = options.onFailover ?? emitFailoverLog;

  let lastUsed: "primary" | "fallback" = "primary";

  async function tryEndpoint(base: string, path: string): Promise<unknown> {
    const url = joinUrl(base, path);
    const resp = await fetchWithTimeout(fetcher, url, timeoutMs);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from ${url}`);
    }
    return resp.json();
  }

  return {
    lastEndpointUsed() {
      return lastUsed;
    },
    async getJson<T = unknown>(path: string): Promise<T> {
      try {
        lastUsed = "primary";
        return (await tryEndpoint(primaryUrl, path)) as T;
      } catch (primaryErr) {
        if (!fallbackUrl) throw primaryErr;
        const reason = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        onFailover({
          type: "horizon.failover",
          primaryUrl,
          fallbackUrl,
          reason,
          at: new Date().toISOString(),
        });
        lastUsed = "fallback";
        return (await tryEndpoint(fallbackUrl, path)) as T;
      }
    },
  };
}

export function emitFailoverLog(event: HorizonFailoverEvent): void {
  console.info(JSON.stringify(event));
}
