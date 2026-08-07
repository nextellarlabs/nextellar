import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import accountTxFeedRouter, {
  __resetFeed,
  __seedPayment,
  __seedTrustline,
  __seedContractEvent,
} from "../routes/account.tx.feed.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(accountTxFeedRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-feed-1";
const BASE_TIME = "2025-06-01T12:00:00.000Z";

describe("GET /account/tx/feed", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetFeed();
  });

  describe("empty feed", () => {
    it("returns empty array with pagination metadata when user has no transactions", async () => {
      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 1,
      });
    });

    it("returns empty for a user with no feed even when other users have data", async () => {
      __seedPayment("other-user", {
        hash: "a".repeat(64),
        amount: "100",
        asset: "XLM",
        source: "GSOURCE1",
        destination: "GDEST1",
        ledgerCloseTime: BASE_TIME,
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  describe("mixed feed", () => {
    it("returns payment items with correct type discriminator", async () => {
      __seedPayment(USER_ID, {
        hash: "a".repeat(64),
        amount: "500",
        asset: "XLM",
        source: "GSOURCE1",
        destination: "GDEST1",
        ledgerCloseTime: BASE_TIME,
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].type).toBe("payment");
      expect(res.body.data[0].amount).toBe("500");
      expect(res.body.data[0].asset).toBe("XLM");
    });

    it("returns trustline items with correct type discriminator", async () => {
      __seedTrustline(USER_ID, {
        hash: "b".repeat(64),
        assetCode: "USDC",
        assetIssuer: "GISSUER1",
        limit: "10000",
        ledgerCloseTime: BASE_TIME,
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].type).toBe("trustline");
      expect(res.body.data[0].assetCode).toBe("USDC");
      expect(res.body.data[0].limit).toBe("10000");
    });

    it("returns contract_event items with correct type discriminator", async () => {
      __seedContractEvent(USER_ID, {
        hash: "c".repeat(64),
        contractId: "CCONTRACT1",
        topic: "transfer",
        value: '"100"',
        ledgerCloseTime: BASE_TIME,
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].type).toBe("contract_event");
      expect(res.body.data[0].contractId).toBe("CCONTRACT1");
      expect(res.body.data[0].topic).toBe("transfer");
    });

    it("combines payments, trustlines, and contract events in a single feed", async () => {
      __seedPayment(USER_ID, {
        hash: "p1",
        amount: "100",
        asset: "XLM",
        source: "GSA",
        destination: "GDA",
        ledgerCloseTime: "2025-06-01T10:00:00.000Z",
      });
      __seedTrustline(USER_ID, {
        hash: "t1",
        assetCode: "USDC",
        assetIssuer: "GISSUER1",
        limit: "5000",
        ledgerCloseTime: "2025-06-01T11:00:00.000Z",
      });
      __seedContractEvent(USER_ID, {
        hash: "e1",
        contractId: "CC1",
        topic: "swap",
        value: '"200"',
        ledgerCloseTime: "2025-06-01T12:00:00.000Z",
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.pagination.total).toBe(3);
    });

    it("sorts feed items by ledgerCloseTime descending", async () => {
      __seedPayment(USER_ID, {
        hash: "early",
        amount: "10",
        asset: "XLM",
        source: "GSA",
        destination: "GDA",
        ledgerCloseTime: "2025-01-01T00:00:00.000Z",
      });
      __seedPayment(USER_ID, {
        hash: "middle",
        amount: "20",
        asset: "XLM",
        source: "GSA",
        destination: "GDA",
        ledgerCloseTime: "2025-06-01T00:00:00.000Z",
      });
      __seedPayment(USER_ID, {
        hash: "latest",
        amount: "30",
        asset: "XLM",
        source: "GSA",
        destination: "GDA",
        ledgerCloseTime: "2025-12-01T00:00:00.000Z",
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.map((i: { hash: string }) => i.hash)).toEqual([
        "latest",
        "middle",
        "early",
      ]);
    });

    it("interleaves different item types in correct time order", async () => {
      __seedContractEvent(USER_ID, {
        hash: "e1",
        contractId: "CC1",
        topic: "mint",
        value: '"50"',
        ledgerCloseTime: "2025-06-01T10:00:00.000Z",
      });
      __seedPayment(USER_ID, {
        hash: "p1",
        amount: "100",
        asset: "XLM",
        source: "GSA",
        destination: "GDA",
        ledgerCloseTime: "2025-06-01T12:00:00.000Z",
      });
      __seedTrustline(USER_ID, {
        hash: "t1",
        assetCode: "USDC",
        assetIssuer: "GISSUER1",
        limit: "2000",
        ledgerCloseTime: "2025-06-01T11:00:00.000Z",
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.data[0].hash).toBe("p1");
      expect(res.body.data[0].type).toBe("payment");
      expect(res.body.data[1].hash).toBe("t1");
      expect(res.body.data[1].type).toBe("trustline");
      expect(res.body.data[2].hash).toBe("e1");
      expect(res.body.data[2].type).toBe("contract_event");
    });

    it("each item carries the fields from its original type", async () => {
      __seedPayment(USER_ID, {
        hash: "p1",
        amount: "250",
        asset: "USDC",
        source: "GSOURCE",
        destination: "GDEST",
        ledgerCloseTime: BASE_TIME,
      });
      __seedTrustline(USER_ID, {
        hash: "t1",
        assetCode: "EURT",
        assetIssuer: "GISSUER2",
        limit: "9999",
        ledgerCloseTime: BASE_TIME,
      });

      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      const payment = res.body.data.find(
        (i: { type: string }) => i.type === "payment",
      );
      expect(payment.amount).toBe("250");
      expect(payment.asset).toBe("USDC");
      expect(payment.source).toBe("GSOURCE");
      expect(payment.destination).toBe("GDEST");

      const trustline = res.body.data.find(
        (i: { type: string }) => i.type === "trustline",
      );
      expect(trustline.assetCode).toBe("EURT");
      expect(trustline.assetIssuer).toBe("GISSUER2");
      expect(trustline.limit).toBe("9999");
    });
  });

  describe("pagination", () => {
    beforeEach(() => {
      for (let i = 1; i <= 25; i++) {
        __seedPayment(USER_ID, {
          hash: `p-${i.toString().padStart(2, "0")}`,
          amount: String(i * 10),
          asset: "XLM",
          source: "GSOURCE",
          destination: "GDEST",
          ledgerCloseTime: new Date(
            2025, 5, i, 12, 0, 0,
          ).toISOString(),
        });
      }
    });

    it("returns first page with default limit of 20", async () => {
      const res = await request(app)
        .get("/account/tx/feed")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(20);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.total).toBe(25);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it("returns second page with remaining items", async () => {
      const res = await request(app)
        .get("/account/tx/feed?page=2&limit=20")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination.page).toBe(2);
      expect(res.body.pagination.total).toBe(25);
    });

    it("respects custom limit", async () => {
      const res = await request(app)
        .get("/account/tx/feed?page=1&limit=5")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination.limit).toBe(5);
      expect(res.body.pagination.totalPages).toBe(5);
    });

    it("returns empty array for page beyond total items", async () => {
      const res = await request(app)
        .get("/account/tx/feed?page=10&limit=20")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.page).toBe(10);
      expect(res.body.pagination.total).toBe(25);
    });

    it("returns 400 for page less than 1", async () => {
      const res = await request(app)
        .get("/account/tx/feed?page=0")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PAGINATION");
    });

    it("returns 400 for limit exceeding maximum", async () => {
      const res = await request(app)
        .get("/account/tx/feed?limit=200")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PAGINATION");
    });

    it("returns 400 for non-numeric limit", async () => {
      const res = await request(app)
        .get("/account/tx/feed?limit=abc")
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_PAGINATION");
    });
  });

  describe("authentication", () => {
    it("returns 401 when x-user-id header is missing", async () => {
      const res = await request(app).get("/account/tx/feed");

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });
});
