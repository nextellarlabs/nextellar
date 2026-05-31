export interface DbConnection {
  id: string;
  lastUsedAt: number;
  ping(): Promise<boolean>;
}

export interface DbPoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMs?: number;
  connectTimeoutMs?: number;
  connect?: () => Promise<DbConnection>;
}

export interface DbPoolMetrics {
  total: number;
  idle: number;
  active: number;
  waiting: number;
  min: number;
  max: number;
}

export interface DbHealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

interface PooledEntry {
  connection: DbConnection;
  idle: boolean;
}

let metricsProvider: (() => DbPoolMetrics) | undefined;

export function registerDbPoolMetrics(provider: () => DbPoolMetrics): void {
  metricsProvider = provider;
}

export function getDbPoolMetrics(): DbPoolMetrics | undefined {
  return metricsProvider?.();
}

export function renderDbPoolMetrics(): string {
  const metrics = metricsProvider?.();
  if (!metrics) {
    return "";
  }

  const lines = [
    "# HELP nextellar_db_pool_total Total connections in the pool.",
    "# TYPE nextellar_db_pool_total gauge",
    `nextellar_db_pool_total ${metrics.total}`,
    "# HELP nextellar_db_pool_idle Idle connections in the pool.",
    "# TYPE nextellar_db_pool_idle gauge",
    `nextellar_db_pool_idle ${metrics.idle}`,
    "# HELP nextellar_db_pool_active Active connections in the pool.",
    "# TYPE nextellar_db_pool_active gauge",
    `nextellar_db_pool_active ${metrics.active}`,
    "# HELP nextellar_db_pool_waiting Clients waiting for a connection.",
    "# TYPE nextellar_db_pool_waiting gauge",
    `nextellar_db_pool_waiting ${metrics.waiting}`,
    "# HELP nextellar_db_pool_min Configured minimum pool size.",
    "# TYPE nextellar_db_pool_min gauge",
    `nextellar_db_pool_min ${metrics.min}`,
    "# HELP nextellar_db_pool_max Configured maximum pool size.",
    "# TYPE nextellar_db_pool_max gauge",
    `nextellar_db_pool_max ${metrics.max}`,
  ];
  return `${lines.join("\n")}\n`;
}

let connectionCounter = 0;

function defaultConnect(): Promise<DbConnection> {
  const id = `conn-${++connectionCounter}`;
  return Promise.resolve({
    id,
    lastUsedAt: Date.now(),
    async ping() {
      return true;
    },
  });
}

export class DbPool {
  private readonly min: number;
  private readonly max: number;
  private readonly idleTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly connectFn: () => Promise<DbConnection>;
  private readonly entries = new Map<string, PooledEntry>();
  private readonly waitQueue: Array<{
    resolve: (conn: DbConnection) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(config: DbPoolConfig = {}) {
    this.min = Math.max(0, config.min ?? 1);
    this.max = Math.max(this.min, config.max ?? 10);
    this.idleTimeoutMs = config.idleTimeoutMs ?? 30_000;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 5_000;
    this.connectFn = config.connect ?? defaultConnect;
    registerDbPoolMetrics(() => this.metrics());
  }

  async warm(): Promise<void> {
    while (this.entries.size < this.min) {
      const connection = await this.connectFn();
      this.entries.set(connection.id, { connection, idle: true });
    }
    this.scheduleIdleSweep();
  }

  async acquire(): Promise<DbConnection> {
    if (this.closed) {
      throw new Error("pool is closed");
    }

    const idle = [...this.entries.values()].find((entry) => entry.idle);
    if (idle) {
      idle.idle = false;
      idle.connection.lastUsedAt = Date.now();
      return idle.connection;
    }

    if (this.entries.size < this.max) {
      const connection = await this.connectFn();
      this.entries.set(connection.id, { connection, idle: false });
      return connection;
    }

    return new Promise<DbConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waitQueue.findIndex((entry) => entry.timer === timer);
        if (index >= 0) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error("acquire timeout"));
      }, this.connectTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  release(connection: DbConnection): void {
    const entry = this.entries.get(connection.id);
    if (!entry) {
      return;
    }

    entry.idle = true;
    entry.connection.lastUsedAt = Date.now();

    const waiter = this.waitQueue.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      entry.idle = false;
      waiter.resolve(entry.connection);
      return;
    }

    this.scheduleIdleSweep();
  }

  metrics(): DbPoolMetrics {
    let idle = 0;
    let active = 0;
    for (const entry of this.entries.values()) {
      if (entry.idle) {
        idle += 1;
      } else {
        active += 1;
      }
    }
    return {
      total: this.entries.size,
      idle,
      active,
      waiting: this.waitQueue.length,
      min: this.min,
      max: this.max,
    };
  }

  async health(): Promise<DbHealthResult> {
    const started = Date.now();
    try {
      const connection = await this.acquire();
      const ok = await connection.ping();
      this.release(connection);
      return { ok, latencyMs: Date.now() - started, error: ok ? undefined : "ping failed" };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : "health check failed",
      };
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    for (const waiter of this.waitQueue.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("pool closed"));
    }
    this.entries.clear();
  }

  private scheduleIdleSweep(): void {
    if (this.idleTimer) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.evictIdle();
    }, this.idleTimeoutMs);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries.entries()) {
      if (!entry.idle) {
        continue;
      }
      if (this.entries.size <= this.min) {
        break;
      }
      if (now - entry.connection.lastUsedAt >= this.idleTimeoutMs) {
        this.entries.delete(id);
      }
    }
    if ([...this.entries.values()].some((entry) => entry.idle) && this.entries.size > this.min) {
      this.scheduleIdleSweep();
    }
  }
}

let defaultPool: DbPool | undefined;

export function getDbPool(config?: DbPoolConfig): DbPool {
  if (!defaultPool) {
    defaultPool = new DbPool(config);
  }
  return defaultPool;
}

export async function resetDbPool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.shutdown();
    defaultPool = undefined;
  }
  registerDbPoolMetrics(() => ({
    total: 0,
    idle: 0,
    active: 0,
    waiting: 0,
    min: 0,
    max: 0,
  }));
}
