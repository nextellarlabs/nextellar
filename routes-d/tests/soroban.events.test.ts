import express, { type Express } from "express";
import request from "supertest";
import {
  SorobanIndexer,
  __resetSorobanEventIds,
  type SorobanRpcLike,
} from "../lib/sorobanIndexer.js";
import { createSorobanEventsRouter } from "../routes/soroban.events.js";

function buildApp(indexer: SorobanIndexer, rpc: SorobanRpcLike): Express {
  const app = express();
  app.use(express.json());
  app.use("/soroban", createSorobanEventsRouter({ contractIds: ["C123"], rpc, indexer }));
  return app;
}

describe("soroban events indexer and route", () => {
  beforeEach(() => {
    __resetSorobanEventIds();
  });

  it("ingests events and returns a paginated query page", async () => {
    const rpc: SorobanRpcLike = {
      async getLatestLedger() {
        return { sequence: 42 };
      },
      async getEvents() {
        return {
          latestLedger: 42,
          events: [
            {
              contractId: "C123",
              topic: ["transfer", "done"],
              ledger: 41,
              ledgerClosedAt: "2026-05-30T00:00:00Z",
              txHash: "abc",
              value: "1",
            },
            {
              contractId: "C123",
              topic: ["mint"],
              ledger: 42,
              ledgerClosedAt: "2026-05-31T00:00:00Z",
              txHash: "def",
            },
          ],
          cursor: "page-1",
        };
      },
    };
    const indexer = new SorobanIndexer({ contractIds: ["C123"], rpc });
    await indexer.ingestOnce();

    const app = express();
    app.use(express.json());
    app.use("/soroban", createSorobanEventsRouter({ contractIds: ["C123"], rpc, indexer }));

    const page1 = await request(app).get("/soroban/events?limit=1");
    expect(page1.status).toBe(200);
    expect(page1.body.events).toHaveLength(1);
    expect(page1.body.pagination.hasMore).toBe(true);

    const page2 = await request(app).get(`/soroban/events?limit=1&cursor=${page1.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.events).toHaveLength(1);
    expect(page2.body.pagination.hasMore).toBe(false);
  });

  it("filters by contractId and topic", async () => {
    const rpc: SorobanRpcLike = {
      async getLatestLedger() {
        return { sequence: 1 };
      },
      async getEvents() {
        return { latestLedger: 1, events: [] };
      },
    };
    const indexer = new SorobanIndexer({ contractIds: ["C123"], rpc });
    indexer.getStore().append([
      {
        id: "evt_a",
        contractId: "C123",
        topic: ["swap"],
        ledger: 1,
        ledgerClosedAt: "t",
        txHash: "h1",
        ingestedAt: "t",
      },
      {
        id: "evt_b",
        contractId: "C999",
        topic: ["swap"],
        ledger: 2,
        ledgerClosedAt: "t",
        txHash: "h2",
        ingestedAt: "t",
      },
    ]);

    const app = buildApp(indexer, rpc);
    const res = await request(app).get("/soroban/events?contractId=C123&topic=swap");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].contractId).toBe("C123");
  });
});
