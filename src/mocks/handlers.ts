// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";
import { xdr } from "@stellar/stellar-sdk";

const defaultRetval = xdr.ScVal.scvString("ok").toXDR("base64");

export const handlers = [
  http.get<{ accountId: string }>(
    "https://horizon-testnet.stellar.org/accounts/:accountId",
    ({ params }) => {
      return HttpResponse.json(
        {
          id: params.accountId,
          account_id: params.accountId,
          balances: [{ asset_type: "native", balance: "1000.0000000" }],
        },
        { status: 200 }
      );
    }
  ),

  http.post("https://soroban-testnet.stellar.org", async ({ request }) => {
    const body = (await request.json()) as {
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };

    const rpcId = body.id ?? 1;

    if (body.method === "simulateTransaction") {
      return HttpResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            latestLedger: 12345,
            minResourceFee: "100",
            transactionData: "AAAAAQAAAAA=",
            results: [],
            result: {
              auth: [],
              retval: defaultRetval,
            },
          },
        },
        { status: 200 }
      );
    }

    if (body.method === "sendTransaction") {
      return HttpResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            status: "PENDING",
            hash: "test-tx-hash",
          },
        },
        { status: 200 }
      );
    }

    return HttpResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: -32601,
          message: `Unsupported RPC method: ${String(body.method)}`,
        },
      },
      { status: 400 }
    );
  }),

  // Soroban RPC - JSON-RPC handler for getEvents
  http.post(
    "https://soroban-testnet.stellar.org",
    async ({ request }) => {
      const body = (await request.json()) as { method?: string; id?: number };

      if (body.method === "getEvents") {
        return HttpResponse.json({
          jsonrpc: "2.0",
          id: body.id ?? 1,
          result: {
            events: [
              {
                id: "evt-001",
                type: "contract",
                ledger: 100,
                ledgerClosedAt: "2024-01-01T00:00:00Z",
                contractId: "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345",
                topic: ["AAAADgAAAAh0cmFuc2Zlcg=="],
                value: "AAAAAQAAAA==",
                pagingToken: "cursor-001",
                txHash: "abc123def456",
                inSuccessfulContractCall: true,
              },
            ],
            latestLedger: 100,
          },
        });
      }

      return HttpResponse.json(
        { jsonrpc: "2.0", id: body.id ?? 1, error: { code: -32601, message: "Method not found" } },
        { status: 200 }
      );
    }
  ),

  // Horizon Orderbook
  http.get("*/order_book", ({ request }) => {
    const url = new URL(request.url);
    const buyingCode = url.searchParams.get("buying_asset_code");
    
    // Simulate error for invalid asset
    if (buyingCode === "INVALID") {
      return new HttpResponse(null, { status: 400, statusText: "Bad Request" });
    }

    // Simulate empty orderbook
    if (buyingCode === "EMPTY") {
      return HttpResponse.json({
        bids: [],
        asks: [],
        base: { asset_type: "native" },
        counter: { asset_type: "credit_alphanum4", asset_code: "EMPTY", asset_issuer: "ISSUER" }
      });
    }

    return HttpResponse.json({
      bids: [
        { price: "0.0800000", amount: "100.0000000", seller: "GA..." },
        { price: "0.0750000", amount: "50.0000000", seller: "GB..." },
      ],
      asks: [
        { price: "0.0850000", amount: "20.0000000", seller: "GC..." },
        { price: "0.0900000", amount: "10.0000000", seller: "GD..." },
      ],
      base: { asset_type: "native" },
      counter: { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "ISSUER" }
    });
  }),
];
