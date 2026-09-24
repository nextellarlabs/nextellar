/**
 * Shared fixtures for component and hook tests.
 *
 * Addresses, Horizon records, balances, and wallet/theme state live here so
 * individual test files do not re-declare the same G-addresses and factories.
 */
import type {
  MockBalance,
  MockWalletAccount,
  MockWalletConfig,
  MockWalletState,
} from "../../src/mocks/wallet-contexts-mock";

// ── Network ───────────────────────────────────────────────────────────────────

export const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
export const SOROBAN_TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const DEFAULT_PAGE_SIZE = 10;

// ── Accounts ──────────────────────────────────────────────────────────────────

/** Deterministic G-address used as the connected wallet in tests. */
export const PUBLIC_KEY =
  "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
export const PUBLIC_KEY_2 =
  "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
export const COUNTERPARTY_PUBLIC_KEY =
  "GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";

/** Short / malformed keys used to exercise validation. */
export const INVALID_PUBLIC_KEY_SHORT = "GABC";
export const INVALID_PUBLIC_KEY_NO_G =
  "XABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

/**
 * Compact account id used by mock-hook tests (not a full 56-char G-address).
 * Kept as a fixture so those tests share one spelling.
 */
export const ACCOUNT_ID = "GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO";
export const SECRET_KEY = "SCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO";
export const PAYMENT_DESTINATION =
  "GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT";

/** Circle USDC on public network. */
export const USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** Circle USDC on testnet (used by useOfferBook). */
export const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const EURC_ISSUER =
  "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO";
export const BTC_ISSUER =
  "GDXTJEK4JZNSTNQAWA53RZNS2GIKTDRPEUWDXELFMKU52XNECNVDVUTD";

export const USDC = { code: "USDC", issuer: USDC_TESTNET_ISSUER };
export const BTC = { code: "BTC", issuer: BTC_ISSUER };

export const CONTRACT_ID =
  "CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345";
export const VALID_CONTRACT_ID =
  "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

export const ACCOUNT_MAIN: MockWalletAccount = {
  address: PUBLIC_KEY,
  displayName: "Main Account",
};
export const ACCOUNT_SECOND: MockWalletAccount = {
  address: PUBLIC_KEY_2,
  displayName: "Second Account",
};

// ── Balances ──────────────────────────────────────────────────────────────────

export function nativeBalance(
  balance = "100.0000000",
): MockBalance & { limit?: string } {
  return { asset_type: "native", balance };
}

export function issuedBalance(
  code: string,
  issuer: string,
  overrides: Partial<MockBalance> & {
    limit?: string;
    is_authorized?: boolean;
  } = {},
): MockBalance & { limit?: string; is_authorized?: boolean } {
  return {
    asset_type: "credit_alphanum4",
    asset_code: code,
    asset_issuer: issuer,
    balance: "250.5000000",
    ...overrides,
  };
}

export const SAMPLE_BALANCES = [
  nativeBalance("100.0000000"),
  issuedBalance("USDC", USDC_ISSUER, {
    balance: "250.5000000",
    limit: "922337203685.4775807",
  }),
];

export const SAMPLE_TRUSTLINE_BALANCES = [
  nativeBalance("1000.0000000"),
  issuedBalance("USDC", USDC_ISSUER, {
    balance: "500.0000000",
    limit: "1000000.0000000",
    is_authorized: true,
  }),
  issuedBalance("EURC", EURC_ISSUER, {
    balance: "0.0000000",
    limit: "500000.0000000",
    is_authorized: false,
  }),
];

export const SAMPLE_TRUSTLINES = [
  {
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    balance: "500.0000000",
    limit: "1000000.0000000",
    authorized: true,
  },
  {
    asset_code: "EURC",
    asset_issuer: EURC_ISSUER,
    balance: "0.0000000",
    limit: "500000.0000000",
    authorized: false,
  },
];

// ── Horizon records ───────────────────────────────────────────────────────────

export type HorizonOperationRecord = {
  id: string;
  type: string;
  type_i: number;
  created_at: string;
  transaction_hash: string;
  source_account: string;
  paging_token: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  transaction_successful?: boolean;
};

/**
 * Deterministic Horizon operation used by hook tests. `index` is baked into
 * id / paging token / timestamp so pagination tests can request contiguous pages.
 */
export function makeHorizonRecord(
  index = 0,
  overrides: Partial<HorizonOperationRecord> = {},
): HorizonOperationRecord {
  return {
    id: `op-${index}`,
    paging_token: `pt-${index}`,
    type: "payment",
    type_i: 1,
    created_at: `2024-01-01T00:${String(index).padStart(2, "0")}:00Z`,
    transaction_hash: `txhash-${index}`,
    source_account: PUBLIC_KEY,
    amount: `${(10 + index).toFixed(7)}`,
    asset_type: "native",
    ...overrides,
  };
}

export function makeHorizonPage(start: number, count: number) {
  return Array.from({ length: count }, (_, i) => makeHorizonRecord(start + i));
}

export function makeHorizonResponse(records: HorizonOperationRecord[]): {
  records: HorizonOperationRecord[];
} {
  return { records };
}

/**
 * Payment-shaped record with a recent timestamp so TransactionList can assert
 * relative time ("just now"). `isReceived` flips from/to against PUBLIC_KEY.
 */
export function makePaymentRecord(
  overrides: Partial<HorizonOperationRecord> & { isReceived?: boolean } = {},
): HorizonOperationRecord {
  const { isReceived = true, ...rest } = overrides;
  const index = rest.id
    ? parseInt(String(rest.id).replace("op-", ""), 10) || 0
    : 0;
  return {
    id: `op-${index}`,
    type: "payment",
    type_i: 1,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: isReceived ? COUNTERPARTY_PUBLIC_KEY : PUBLIC_KEY,
    paging_token: `pt-${index}`,
    amount: `${(100 + index).toFixed(7)}`,
    asset_type: "native",
    from: isReceived ? COUNTERPARTY_PUBLIC_KEY : PUBLIC_KEY,
    to: isReceived ? PUBLIC_KEY : COUNTERPARTY_PUBLIC_KEY,
    transaction_successful: true,
    ...rest,
  };
}

export function makeNonPaymentRecord(
  overrides: Partial<HorizonOperationRecord> = {},
): HorizonOperationRecord {
  const index = overrides.id
    ? parseInt(String(overrides.id).replace("op-", ""), 10) || 0
    : 0;
  return {
    id: `op-${index}`,
    type: "create_account",
    type_i: 0,
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    transaction_hash: `txhash-${index}`,
    source_account: COUNTERPARTY_PUBLIC_KEY,
    paging_token: `pt-${index}`,
    transaction_successful: true,
    ...overrides,
  };
}

export function createTransactionHistoryState<T = HorizonOperationRecord>(
  partial: Partial<{
    items: T[];
    loading: boolean;
    error: Error | null;
    hasMore: boolean;
    fetchNextPage: () => Promise<void>;
    refresh: () => Promise<void>;
  }> = {},
) {
  return {
    items: [] as T[],
    loading: false,
    error: null as Error | null,
    hasMore: false,
    fetchNextPage: async () => {},
    refresh: async () => {},
    ...partial,
  };
}

/**
 * SDK-shaped Soroban event (rpc.Api.EventResponse). Topic/value expose
 * `toXDR()` and contractId exposes `toString()`, matching the real SDK.
 */
export function makeSdkEvent(overrides: Record<string, unknown> = {}): {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: { toString: () => string };
  topic: { toXDR: () => string }[];
  value: { toXDR: () => string };
  txHash: string;
  inSuccessfulContractCall: boolean;
} {
  const {
    id = "evt-001",
    type = "contract",
    ledger = 100,
    ledgerClosedAt = "2024-01-01T00:00:00Z",
    contractId = CONTRACT_ID,
    topic = ["AAAADgAAAAh0cmFuc2Zlcg=="],
    value = "AAAAAQAAAA==",
    txHash = "abc123def456",
    inSuccessfulContractCall = true,
  } = overrides;

  return {
    id: id as string,
    type: type as string,
    ledger: ledger as number,
    ledgerClosedAt: ledgerClosedAt as string,
    contractId: { toString: () => contractId as string },
    topic: (topic as string[]).map((t) => ({ toXDR: () => t })),
    value: { toXDR: () => value as string },
    txHash: txHash as string,
    inSuccessfulContractCall: inSuccessfulContractCall as boolean,
  };
}

// ── Wallet / theme state ──────────────────────────────────────────────────────

export type ThemeState = {
  theme: "light" | "dark" | "system";
  resolvedTheme: "light" | "dark";
  setTheme: (theme: "light" | "dark" | "system") => void;
};

export function createWalletState(
  overrides: Partial<MockWalletState> = {},
): MockWalletState {
  return {
    connected: false,
    publicKey: undefined,
    walletName: undefined,
    balances: [],
    accounts: [],
    currentAccountIndex: 0,
    connect: async () => {},
    disconnect: () => {},
    refreshBalances: async () => {},
    switchAccount: async () => {},
    ...overrides,
  };
}

export function disconnectedWallet(
  overrides: Partial<MockWalletState> = {},
): MockWalletState {
  return createWalletState(overrides);
}

export function connectedWallet(
  overrides: Partial<MockWalletState> = {},
): MockWalletState {
  return createWalletState({
    connected: true,
    publicKey: PUBLIC_KEY,
    walletName: "Freighter",
    accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
    currentAccountIndex: 0,
    balances: SAMPLE_BALANCES,
    ...overrides,
  });
}

export function createWalletConfig(
  overrides: Partial<MockWalletConfig> = {},
): MockWalletConfig {
  return {
    activeNetworkKey: "testnet",
    horizonUrl: HORIZON_TESTNET_URL,
    sorobanUrl: SOROBAN_TESTNET_RPC,
    network: "TESTNET",
    switchNetwork: () => {},
    ...overrides,
  };
}

export function createThemeState(
  overrides: Partial<ThemeState> = {},
): ThemeState {
  return {
    theme: "system",
    resolvedTheme: "light",
    setTheme: () => {},
    ...overrides,
  };
}
