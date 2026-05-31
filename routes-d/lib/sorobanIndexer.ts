export interface SorobanEventRecord {
  id: string;
  contractId: string;
  topic: string[];
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  ingestedAt: string;
  value?: string;
}

export interface SorobanEventPage {
  events: SorobanEventRecord[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SorobanRpcEvent {
  contractId: string;
  topic: string[];
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  value?: string;
}

export interface SorobanRpcLike {
  getLatestLedger(): Promise<{ sequence: number }>;
  getEvents(params: {
    startLedger: number;
    contractIds: string[];
    limit?: number;
    cursor?: string;
  }): Promise<{
    events: SorobanRpcEvent[];
    latestLedger: number;
    cursor?: string;
  }>;
}

export interface SorobanIndexerOptions {
  contractIds: string[];
  rpc: SorobanRpcLike;
  store?: SorobanEventStore;
  pollIntervalMs?: number;
  now?: () => Date;
}

export interface SorobanEventStore {
  append(events: SorobanEventRecord[]): void;
  query(params: {
    contractId?: string;
    topic?: string;
    limit: number;
    cursor?: string;
  }): SorobanEventPage;
  count(): number;
}

export function createInMemoryEventStore(): SorobanEventStore {
  const records: SorobanEventRecord[] = [];

  return {
    append(events) {
      records.push(...events);
      records.sort((a, b) => {
        if (a.ledger !== b.ledger) return a.ledger - b.ledger;
        return a.id.localeCompare(b.id);
      });
    },
    query({ contractId, topic, limit, cursor }) {
      let filtered = records;
      if (contractId) {
        filtered = filtered.filter((e) => e.contractId === contractId);
      }
      if (topic) {
        filtered = filtered.filter((e) => e.topic.join(":") === topic || e.topic[0] === topic);
      }
      let start = 0;
      if (cursor) {
        const idx = filtered.findIndex((e) => e.id === cursor);
        start = idx >= 0 ? idx + 1 : 0;
      }
      const slice = filtered.slice(start, start + limit);
      const hasMore = start + limit < filtered.length;
      const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : undefined;
      return { events: slice, nextCursor, hasMore };
    },
    count() {
      return records.length;
    },
  };
}

let idCounter = 0;

export function __resetSorobanEventIds(): void {
  idCounter = 0;
}

function nextId(): string {
  idCounter += 1;
  return `evt_${idCounter}`;
}

export function mapRpcEvent(event: SorobanRpcEvent, ingestedAt: string): SorobanEventRecord {
  return {
    id: nextId(),
    contractId: event.contractId,
    topic: event.topic,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
    value: event.value,
    ingestedAt,
  };
}

export class SorobanIndexer {
  private readonly store: SorobanEventStore;
  private readonly contractIds: string[];
  private readonly rpc: SorobanRpcLike;
  private readonly now: () => Date;
  private tailCursor?: string;
  private tailTimer?: ReturnType<typeof setInterval>;
  private lastLedger = 0;

  constructor(options: SorobanIndexerOptions) {
    this.contractIds = options.contractIds;
    this.rpc = options.rpc;
    this.store = options.store ?? createInMemoryEventStore();
    this.now = options.now ?? (() => new Date());
    const interval = options.pollIntervalMs ?? 0;
    if (interval > 0) {
      this.tailTimer = setInterval(() => {
        void this.ingestOnce();
      }, interval);
    }
  }

  getStore(): SorobanEventStore {
    return this.store;
  }

  stop(): void {
    if (this.tailTimer) clearInterval(this.tailTimer);
  }

  async ingestOnce(): Promise<number> {
    const latest = await this.rpc.getLatestLedger();
    const startLedger = this.lastLedger > 0 ? this.lastLedger + 1 : Math.max(1, latest.sequence - 1);
    const page = await this.rpc.getEvents({
      startLedger,
      contractIds: this.contractIds,
      limit: 200,
      cursor: this.tailCursor,
    });
    const ingestedAt = this.now().toISOString();
    const mapped = page.events.map((e) => mapRpcEvent(e, ingestedAt));
    if (mapped.length > 0) {
      this.store.append(mapped);
    }
    this.lastLedger = page.latestLedger;
    this.tailCursor = page.cursor;
    return mapped.length;
  }

  query(params: {
    contractId?: string;
    topic?: string;
    limit: number;
    cursor?: string;
  }): SorobanEventPage {
    return this.store.query(params);
  }
}
