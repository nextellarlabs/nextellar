import request from "supertest";
import express from "express";
import { createStellarBalanceRouter } from "../routes/stellar.balance.js";
import { balanceCache, type BalanceEntry } from "../lib/balanceCache.js";

const VALID_ACCOUNT =
  "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234";

function buildApp(fetcher: (id: string) => Promise<BalanceEntry[]>) {
  const app = express();
  app.use(express.json());
  app.use(createStellarBalanceRouter({ fetcher }));
  return app;
}

beforeEach(() => {
  balanceCache.clear();
});

describe("Cached Stellar balance route (#274)", () => {
  it("returns 400 for an invalid account id", async () => {
    const app = buildApp(async () => []);
    const res = await request(app).get("/stellar/balance/not-an-account");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_account_id" });
  });

  it("populates the cache on first hit (miss) and serves from cache on second (hit)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [
        { assetType: "native", balance: "100.0000000" },
      ];
    };
    const app = buildApp(fetcher);

    const miss = await request(app).get(`/stellar/balance/${VALID_ACCOUNT}`);
    expect(miss.status).toBe(200);
    expect(miss.body.data.fromCache).toBe(false);

    const hit = await request(app).get(`/stellar/balance/${VALID_ACCOUNT}`);
    expect(hit.status).toBe(200);
    expect(hit.body.data.fromCache).toBe(true);

    expect(calls).toBe(1);
  });

  it("bypasses the cache when refresh=true", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [{ assetType: "native", balance: String(calls) }];
    };
    const app = buildApp(fetcher);

    await request(app).get(`/stellar/balance/${VALID_ACCOUNT}`);
    const refreshed = await request(app).get(
      `/stellar/balance/${VALID_ACCOUNT}?refresh=true`,
    );

    expect(refreshed.body.data.fromCache).toBe(false);
    expect(refreshed.body.data.balances[0].balance).toBe("2");
    expect(calls).toBe(2);
  });

  it("invalidates on outbound payment then refetches", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [{ assetType: "native", balance: String(calls) }];
    };
    const app = buildApp(fetcher);

    // Prime cache
    await request(app).get(`/stellar/balance/${VALID_ACCOUNT}`);

    // Outbound payment from this account → invalidate
    const inv = await request(app)
      .post("/stellar/balance/invalidate-on-payment")
      .send({ from: VALID_ACCOUNT });
    expect(inv.status).toBe(200);
    expect(inv.body.data.removed).toBe(true);

    const afterInvalidate = await request(app).get(
      `/stellar/balance/${VALID_ACCOUNT}`,
    );
    expect(afterInvalidate.body.data.fromCache).toBe(false);
    expect(calls).toBe(2);
  });

  it("invalidate-on-payment returns 400 for an invalid sender", async () => {
    const app = buildApp(async () => []);
    const res = await request(app)
      .post("/stellar/balance/invalidate-on-payment")
      .send({ from: "not-an-account" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_from_account" });
  });
});
