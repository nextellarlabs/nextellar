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

export const xdr = {
  ScVal: {
    scvString: (val: string) => ({
      toXDR: (_fmt: string) => Buffer.from(val).toString('base64'),
    }),
  },
};
