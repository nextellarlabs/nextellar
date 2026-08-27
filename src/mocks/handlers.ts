// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";
import { xdr } from "@stellar/stellar-sdk";
import {
  createMockAccount,
  createMockOperationRecord,
  createPaginatedResponse,
} from "./horizon-handlers.js";

const defaultRetval = xdr.ScVal.scvString("ok").toXDR("base64");

// Create custom account handler that handles 404 for unfunded accounts
const customAccountHandler = http.get(
  "https://horizon-testnet.stellar.org/accounts/:accountId",
  ({ params }) => {
    // Return 404 for specific account IDs (for testing unfunded accounts)
    if (params.accountId === "UNFUNDED_ACCOUNT_ID") {
      return HttpResponse.json(
        {
          status: 404,
          title: "Not Found",
          detail: "The requested account does not exist",
        },
        { status: 404 }
      );
    }

    // Use the helper function from horizon-handlers to create mock account
    const account = createMockAccount(params.accountId);
    return HttpResponse.json(account, { status: 200 });
  }
);

// Horizon payments endpoint with pagination support
const paymentsHandler = http.get<{ accountId: string }>(
  "https://horizon-testnet.stellar.org/accounts/:accountId/payments",
  ({ request, params }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || "10");
    const cursor = url.searchParams.get("cursor");
    const startIndex = cursor ? Number(cursor.replace("cursor-", "")) + 1 : 0;

    const records = Array.from({ length: limit }, (_, i) =>
      createMockOperationRecord(startIndex + i, "payment")
    );

    return HttpResponse.json(
      createPaginatedResponse(
        records,
        "https://horizon-testnet.stellar.org",
        params.accountId,
        "payments",
        limit,
        startIndex
      ),
      { status: 200 }
    );
  }
);

// Horizon operations endpoint with pagination support
const operationsHandler = http.get<{ accountId: string }>(
  "https://horizon-testnet.stellar.org/accounts/:accountId/operations",
  ({ request, params }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || "10");
    const cursor = url.searchParams.get("cursor");
    const startIndex = cursor ? Number(cursor.replace("cursor-", "")) + 1 : 0;

    const records = Array.from({ length: limit }, (_, i) =>
      createMockOperationRecord(startIndex + i, "create_account")
    );

    return HttpResponse.json(
      createPaginatedResponse(
        records,
        "https://horizon-testnet.stellar.org",
        params.accountId,
        "operations",
        limit,
        startIndex
      ),
      { status: 200 }
    );
  }
);

export const handlers = [
  // Use the modular Horizon handlers
  customAccountHandler,
  paymentsHandler,
  operationsHandler,

  // Soroban RPC - simulateTransaction and sendTransaction
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

  // Soroban RPC - getEvents
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

  // Horizon order_book endpoint for useOfferBook
  http.get(
    "https://horizon-testnet.stellar.org/order_book",
    () => {
      return HttpResponse.json({
        bids: [
          { price: "0.5000000", amount: "100.0000000" },
          { price: "0.4900000", amount: "200.0000000" },
        ],
        asks: [
          { price: "0.5100000", amount: "150.0000000" },
          { price: "0.5200000", amount: "250.0000000" },
        ],
      });
    }
  ),
];
