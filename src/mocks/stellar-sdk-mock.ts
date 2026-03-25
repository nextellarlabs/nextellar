/**
 * Shared mock for @stellar/stellar-sdk used by template hook tests.
 * The jest.config moduleNameMapper redirects '@stellar/stellar-sdk' to this file.
 * Tests import mockGetEvents / mockServerConstructor to control behavior.
 */
import * as StellarSDK from "../../node_modules/@stellar/stellar-sdk/lib/index.js";

export const {
  xdr,
  Address,
  Contract,
  Account,
  TransactionBuilder,
  Networks,
} = StellarSDK;

// Mock Keypair to avoid noble-curves crypto issues in Jest/jsdom
export const Keypair = {
  ...StellarSDK.Keypair,
  fromSecret: (secret: string) => ({
    publicKey: () => "GD6QX7A2B5LOGNTBRSE7FOKD7VZYE7E74BE33NNZCR2HEFRMUBJTKHSP",
    secret: () => secret,
    sign: (data: any) => Buffer.alloc(64),
    canSign: () => true,
  }),
  random: () => ({
    publicKey: () => "GD6QX7A2B5LOGNTBRSE7FOKD7VZYE7E74BE33NNZCR2HEFRMUBJTKHSP",
    secret: () => "SA3BIFV52MUCXKI52NWZ35ILXBQWZPH3QSNO3KGPWKTQJFZQCLBG7AA4",
    sign: (data: any) => Buffer.alloc(64),
    canSign: () => true,
  }),
  fromRawEd25519Seed: (seed: any) => ({
    publicKey: () => "GD6QX7A2B5LOGNTBRSE7FOKD7VZYE7E74BE33NNZCR2HEFRMUBJTKHSP",
    secret: () => "SA3BIFV52MUCXKI52NWZ35ILXBQWZPH3QSNO3KGPWKTQJFZQCLBG7AA4",
    sign: (data: any) => Buffer.alloc(64),
    canSign: () => true,
  })
};

export const mockGetEvents = jest.fn();
export const mockSimulateTransaction = jest.fn();
export const mockSendTransaction = jest.fn();

class MockRpcServer {
  simulateTransaction(...args: unknown[]) { return mockSimulateTransaction(...args); }
  sendTransaction(...args: unknown[]) { return mockSendTransaction(...args); }
  getEvents(...args: unknown[]) { return mockGetEvents(...args); }
}

export const mockServerConstructor = jest.fn().mockImplementation(() => new MockRpcServer());
// Maintain prototype for jest.spyOn(rpc.Server.prototype, ...)
mockServerConstructor.prototype = MockRpcServer.prototype;

export const rpc = {
  Server: mockServerConstructor,
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
