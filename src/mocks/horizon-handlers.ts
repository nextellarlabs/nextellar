// src/mocks/horizon-handlers.ts
import { http, HttpResponse } from "msw";

/**
 * Horizon environment configuration
 */
export type HorizonEnvironment = "testnet" | "public" | "custom";

/**
 * Horizon environment URLs
 */
export const HORIZON_URLS: Record<HorizonEnvironment, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  public: "https://horizon.stellar.org",
  custom: "https://horizon.example.com",
};

/**
 * Mock account balance interface
 */
export interface MockBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
  last_modified_ledger?: number;
  is_authorized?: boolean;
  is_authorized_to_maintain_liabilities?: boolean;
}

/**
 * Mock account interface
 */
export interface MockAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  inflation_destination?: string;
  last_modified_ledger: number;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  flags: {
    auth_required: boolean;
    auth_revocable: boolean;
    auth_immutable: boolean;
  };
  balances: MockBalance[];
  signers: Array<{
    public_key: string;
    weight: number;
    key?: string;
    type?: string;
  }>;
  data: Record<string, string>;
  paging_token?: string;
  sponsor?: string;
  num_sponsoring?: number;
  num_sponsored?: number;
}

/**
 * Mock operation record interface
 */
export interface MockOperationRecord {
  id: string;
  paging_token: string;
  source_account: string;
  type: string;
  type_i: number;
  created_at: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  source_account_sequence?: string;
  operation_index?: number;
  // Payment-specific fields
  from?: string;
  to?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  // Create account specific fields
  starting_balance?: string;
  funder?: string;
  // Common fields
  fee_charged?: string;
  fee_meta?: string;
  memo?: string;
  memo_type?: string;
}

/**
 * Horizon response with pagination
 */
export interface HorizonPaginatedResponse<T> {
  _embedded: {
    records: T[];
  };
  _links: {
    self: { href: string };
    next?: { href: string };
    prev?: { href: string };
  };
}

/**
 * Configuration for creating mock accounts
 */
export interface MockAccountConfig {
  balances?: MockBalance[];
  sequence?: string;
  signers?: Array<{ public_key: string; weight: number }>;
}

/**
 * Default mock balances
 */
export const DEFAULT_BALANCES: MockBalance[] = [
  {
    asset_type: "native",
    balance: "1000.0000000",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    last_modified_ledger: 12345,
    is_authorized: true,
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
    balance: "500.0000000",
    limit: "10000.0000000",
    buying_liabilities: "0.0000000",
    selling_liabilities: "0.0000000",
    last_modified_ledger: 12345,
    is_authorized: true,
  },
];

/**
 * Create a mock account object
 */
export function createMockAccount(
  accountId: string,
  config: MockAccountConfig = {}
): MockAccount {
  return {
    id: accountId,
    account_id: accountId,
    sequence: config.sequence || "123456789",
    subentry_count: 0,
    last_modified_ledger: 12345,
    inflation_destination: undefined,
    thresholds: {
      low_threshold: 0,
      med_threshold: 0,
      high_threshold: 0,
    },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
    },
    balances: config.balances || DEFAULT_BALANCES,
    signers: config.signers || [
      {
        public_key: accountId,
        weight: 1,
        key: accountId,
        type: "ed25519_public_key",
      },
    ],
    data: {},
    paging_token: "account-token-1",
    sponsor: undefined,
    num_sponsoring: 0,
    num_sponsored: 0,
  };
}

/**
 * Create a mock operation record
 */
export function createMockOperationRecord(
  index: number,
  type: "payment" | "create_account" | "path_payment" | "manage_buy_offer" = "payment",
  customFields: Partial<MockOperationRecord> = {}
): MockOperationRecord {
  const baseRecord: MockOperationRecord = {
    id: `op-${index}`,
    paging_token: `cursor-${index}`,
    type,
    type_i: type === "payment" ? 1 : type === "create_account" ? 0 : type === "path_payment" ? 2 : 3,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
    transaction_successful: true,
    source_account_sequence: "123456789",
    operation_index: index,
    fee_charged: "100",
    amount: `${(10 + index).toFixed(7)}`,
    asset_type: "native",
  };

  // Add type-specific fields
  if (type === "payment") {
    baseRecord.from = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
    baseRecord.to = "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
  } else if (type === "create_account") {
    baseRecord.starting_balance = "10.0000000";
    baseRecord.funder = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
  }

  return { ...baseRecord, ...customFields };
}

/**
 * Create a paginated Horizon response
 */
export function createPaginatedResponse<T>(
  records: T[],
  baseUrl: string,
  accountId: string,
  endpoint: string,
  limit: number,
  startIndex: number
): HorizonPaginatedResponse<T> {
  return {
    _embedded: { records },
    _links: {
      self: {
        href: `${baseUrl}/accounts/${accountId}/${endpoint}?limit=${limit}&order=desc`,
      },
      next: {
        href: `${baseUrl}/accounts/${accountId}/${endpoint}?cursor=cursor-${startIndex + limit - 1}&limit=${limit}&order=desc`,
      },
    },
  };
}

/**
 * Generate MSW handlers for Horizon account endpoint
 */
export function createAccountHandler(
  environment: HorizonEnvironment = "testnet",
  customAccounts?: Record<string, MockAccount>
) {
  const baseUrl = HORIZON_URLS[environment];

  return http.get<{ accountId: string }>(
    `${baseUrl}/accounts/:accountId`,
    ({ params }) => {
      const accountId = params.accountId;

      // Use custom account if provided, otherwise create default
      const account =
        customAccounts?.[accountId] || createMockAccount(accountId);

      return HttpResponse.json(account, { status: 200 });
    }
  );
}

/**
 * Generate MSW handlers for Horizon payments endpoint
 */
export function createPaymentsHandler(
  environment: HorizonEnvironment = "testnet",
  customOperations?: MockOperationRecord[]
) {
  const baseUrl = HORIZON_URLS[environment];

  return http.get<{ accountId: string }>(
    `${baseUrl}/accounts/:accountId/payments`,
    ({ request, params }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") || "10");
      const cursor = url.searchParams.get("cursor");
      const startIndex = cursor
        ? Number(cursor.replace("cursor-", "")) + 1
        : 0;

      // Use custom operations if provided, otherwise generate default
      const records = customOperations
        ? customOperations.slice(startIndex, startIndex + limit)
        : Array.from({ length: limit }, (_, i) =>
            createMockOperationRecord(startIndex + i, "payment")
          );

      return HttpResponse.json(
        createPaginatedResponse(
          records,
          baseUrl,
          params.accountId,
          "payments",
          limit,
          startIndex
        ),
        { status: 200 }
      );
    }
  );
}

/**
 * Generate MSW handlers for Horizon operations endpoint
 */
export function createOperationsHandler(
  environment: HorizonEnvironment = "testnet",
  customOperations?: MockOperationRecord[]
) {
  const baseUrl = HORIZON_URLS[environment];

  return http.get<{ accountId: string }>(
    `${baseUrl}/accounts/:accountId/operations`,
    ({ request, params }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get("limit") || "10");
      const cursor = url.searchParams.get("cursor");
      const startIndex = cursor
        ? Number(cursor.replace("cursor-", "")) + 1
        : 0;

      // Use custom operations if provided, otherwise generate default
      const records = customOperations
        ? customOperations.slice(startIndex, startIndex + limit)
        : Array.from({ length: limit }, (_, i) =>
            createMockOperationRecord(startIndex + i, "create_account")
          );

      return HttpResponse.json(
        createPaginatedResponse(
          records,
          baseUrl,
          params.accountId,
          "operations",
          limit,
          startIndex
        ),
        { status: 200 }
      );
    }
  );
}

/**
 * Generate MSW handlers for Horizon trustlines endpoint
 */
export function createTrustlinesHandler(
  environment: HorizonEnvironment = "testnet",
  customBalances?: MockBalance[]
) {
  const baseUrl = HORIZON_URLS[environment];

  return http.get<{ accountId: string }>(
    `${baseUrl}/accounts/:accountId`,
    ({ params }) => {
      const accountId = params.accountId;

      // Use custom balances if provided, otherwise use defaults
      const balances = customBalances || DEFAULT_BALANCES;

      const account = createMockAccount(accountId, { balances });

      return HttpResponse.json(account, { status: 200 });
    }
  );
}

/**
 * Generate complete set of Horizon handlers for a given environment
 */
export function createHorizonHandlers(
  environment: HorizonEnvironment = "testnet",
  config: {
    customAccounts?: Record<string, MockAccount>;
    customOperations?: MockOperationRecord[];
    customBalances?: MockBalance[];
  } = {}
) {
  return [
    createAccountHandler(environment, config.customAccounts),
    createPaymentsHandler(environment, config.customOperations),
    createOperationsHandler(environment, config.customOperations),
    createTrustlinesHandler(environment, config.customBalances),
  ];
}

/**
 * Create handlers for multiple Horizon environments
 */
export function createMultiEnvironmentHandlers(
  environments: HorizonEnvironment[] = ["testnet", "public"],
  config?: {
    customAccounts?: Record<string, MockAccount>;
    customOperations?: MockOperationRecord[];
    customBalances?: MockBalance[];
  }
) {
  const handlers: ReturnType<typeof createHorizonHandlers> = [];

  for (const env of environments) {
    handlers.push(...createHorizonHandlers(env, config));
  }

  return handlers;
}

/**
 * Utility function to create a 404 response for unfunded accounts
 */
export function createAccountNotFoundHandler(
  environment: HorizonEnvironment = "testnet"
) {
  const baseUrl = HORIZON_URLS[environment];

  return http.get<{ accountId: string }>(
    `${baseUrl}/accounts/:accountId`,
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

      // Default to successful response
      return HttpResponse.json(createMockAccount(params.accountId), {
        status: 200,
      });
    }
  );
}

// Export a default object for compatibility
export default {
  createMockAccount,
  createMockOperationRecord,
  createPaginatedResponse,
  createAccountHandler,
  createPaymentsHandler,
  createOperationsHandler,
  createTrustlinesHandler,
  createHorizonHandlers,
  createMultiEnvironmentHandlers,
  createAccountNotFoundHandler,
  DEFAULT_BALANCES,
  HORIZON_URLS,
};
