export const mockGetEvents = jest.fn();

export const mockServerConstructor = jest.fn().mockImplementation(() => ({
  getEvents: mockGetEvents,
}));

export const rpc = {
  Server: mockServerConstructor,
};

export const mockHorizonCall = jest.fn();

function makeBuilder() {
  const builder = {};
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
