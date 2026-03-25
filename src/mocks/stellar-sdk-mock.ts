/**
 * Shared mock for @stellar/stellar-sdk used by template hook tests.
 * The jest.config moduleNameMapper redirects '@stellar/stellar-sdk' to this file.
 * Tests import mockGetEvents / mockServerConstructor to control behavior.
 *
 * Re-exports real SDK symbols so hooks that import Address, xdr, Contract, etc.
 * can function normally while rpc.Server is fully mocked.
 */
export {
  xdr,
  Address,
  Contract,
  Account,
  TransactionBuilder,
  Networks,
  Keypair,
} from "../../node_modules/@stellar/stellar-sdk/lib/index.js";

export const mockGetEvents = jest.fn();
export const mockSimulateTransaction = jest.fn();
export const mockSendTransaction = jest.fn();

class MockRpcServer {
  simulateTransaction(...args: unknown[]) { return mockSimulateTransaction(...args); }
  sendTransaction(...args: unknown[]) { return mockSendTransaction(...args); }
  getEvents(...args: unknown[]) { return mockGetEvents(...args); }
}

export const mockServerConstructor = MockRpcServer;

export const rpc = {
  Server: MockRpcServer,
};

// ── Horizon mock for useTransactionHistory ──────────────────────────────────

export const mockHorizonCall = jest.fn();

/** Chainable builder returned by .payments() / .operations() */
function makeBuilder() {
  const builder: Record<string, jest.Mock> = {};
  const chain = () => builder;
  builder.forAccount = jest.fn(chain);
  builder.order = jest.fn(chain);
  builder.limit = jest.fn(chain);
  builder.cursor = jest.fn(chain);
  builder.call = mockHorizonCall;
  return builder;
}

export const mockPayments = jest.fn(makeBuilder);
export const mockOperations = jest.fn(makeBuilder);

export const mockHorizonServerConstructor = jest.fn().mockImplementation(() => ({
  payments: mockPayments,
  operations: mockOperations,
}));

export const Horizon = {
  Server: mockHorizonServerConstructor,
};
