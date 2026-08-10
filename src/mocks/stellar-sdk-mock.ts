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
