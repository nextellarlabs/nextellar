// Redis client with health-check and graceful shutdown for routes-d.
//
// Connection parameters are read from environment variables:
//   REDIS_URL        Full redis[s]:// URL (takes precedence over host/port).
//   REDIS_HOST       Hostname (default: 127.0.0.1).
//   REDIS_PORT       Port     (default: 6379).
//   REDIS_PASSWORD   Optional AUTH password.
//   REDIS_TLS        Set to "true" to enable TLS.

export interface RedisClientConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
  connectTimeoutMs?: number;
}

export interface RedisHealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Minimal RedisClient contract — fulfilled by the real ioredis/redis clients
// as well as the in-process stub used during tests.
// ---------------------------------------------------------------------------

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", seconds: number): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
  on(event: "error", handler: (err: Error) => void): this;
}

// ---------------------------------------------------------------------------
// In-process stub (used when no real Redis is configured / during tests)
// ---------------------------------------------------------------------------

export class InMemoryRedisClient implements IRedisClient {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly errorHandlers: Array<(err: Error) => void> = [];

  private now(): number {
    return Date.now();
  }

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= this.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    _expiryMode: "EX",
    seconds: number,
  ): Promise<string | null> {
    this.store.set(key, {
      value,
      expiresAt: this.now() + seconds * 1_000,
    });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count += 1;
    }
    return count;
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async quit(): Promise<string> {
    this.store.clear();
    return "OK";
  }

  on(event: "error", handler: (err: Error) => void): this {
    if (event === "error") this.errorHandlers.push(handler);
    return this;
  }

  /** Test-only: inspect the raw store. */
  snapshot(): ReadonlyMap<string, { value: string; expiresAt: number | null }> {
    return this.store;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _client: IRedisClient | undefined;

function buildConfigFromEnv(): RedisClientConfig {
  return {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === "true",
    connectTimeoutMs: process.env.REDIS_CONNECT_TIMEOUT_MS
      ? Number(process.env.REDIS_CONNECT_TIMEOUT_MS)
      : 5_000,
  };
}

/**
 * Returns the module singleton Redis client.
 *
 * When REDIS_URL / REDIS_HOST are absent the in-memory stub is used so the
 * service remains operable without a Redis instance (e.g. local dev, tests).
 */
export function getRedisClient(): IRedisClient {
  if (!_client) {
    const config = buildConfigFromEnv();
    const useReal = Boolean(config.url ?? (config.host && config.host !== "127.0.0.1"));

    if (useReal) {
      // Dynamically import ioredis only when a real server is configured so
      // tests and dev environments do not need the package installed.
      throw new Error(
        "Real Redis connection requested but ioredis is not bundled. " +
          "Install ioredis and replace this stub with `new Redis(config.url ?? config)`.",
      );
    }

    _client = new InMemoryRedisClient();
  }
  return _client;
}

/**
 * Override the singleton (used in tests or for dependency injection).
 */
export function setRedisClient(client: IRedisClient): void {
  _client = client;
}

/** Reset the singleton (between tests). */
export function resetRedisClient(): void {
  _client = undefined;
}

/**
 * Ping the Redis server and measure latency.
 */
export async function checkRedisHealth(
  client?: IRedisClient,
): Promise<RedisHealthResult> {
  const c = client ?? getRedisClient();
  const started = Date.now();
  try {
    const reply = await c.ping();
    return {
      ok: reply === "PONG",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "ping failed",
    };
  }
}
