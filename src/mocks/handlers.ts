// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";

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
];
