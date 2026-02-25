/**
 * Shared mock for @stellar/stellar-sdk used by template hook tests.
 * The jest.config moduleNameMapper redirects '@stellar/stellar-sdk' to this file.
 * Tests import mockGetEvents / mockServerConstructor to control behavior.
 */

export const mockGetEvents = jest.fn();

export const mockServerConstructor = jest.fn().mockImplementation(() => ({
  getEvents: mockGetEvents,
}));

export const rpc = {
  Server: mockServerConstructor,
};

// Horizon
export const Horizon = {
  Server: jest.fn().mockImplementation(() => ({
    accounts: jest.fn().mockReturnValue({
      accountId: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ balances: [] }),
      }),
    }),
    loadAccount: jest.fn().mockResolvedValue({}),
    submitTransaction: jest.fn().mockResolvedValue({}),
  })),
};

// TransactionBuilder
export class TransactionBuilder {
  constructor() {}
  addOperation() { return this; }
  addMemo() { return this; }
  setTimeout() { return this; }
  build() { return { toXDR: () => 'mock-xdr', sign: jest.fn() }; }
  static fromXDR() { return { sign: jest.fn() }; }
}

// Operation
export const Operation = {
  payment: jest.fn(),
};

// Networks
export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};

// Asset
export class Asset {
  constructor(public code: string, public issuer: string) {}
  static native() { return new Asset('XLM', ''); }
}

// Memo
export const Memo = {
  text: jest.fn(),
};

export const BASE_FEE = 100;

// Keypair
export const Keypair = {
  fromSecret: jest.fn().mockReturnValue({ sign: jest.fn() }),
};

// xdr
export const xdr = {
  ScVal: {
    scvString: jest.fn().mockReturnValue({ toXDR: jest.fn() }),
  },
};
