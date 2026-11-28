/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";

const VALID_PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_PUBLIC_KEY_2 =
  "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQ7N";
const INVALID_PUBLIC_KEY_SHORT = "GSHORT";
const INVALID_PUBLIC_KEY_NO_G =
  "XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

let streamHandlers: {
  onmessage?: () => void;
  onerror?: (err: unknown) => void;
} = {};

const mockEffectsCall = jest.fn<() => Promise<{ records: unknown[] }>>();
const mockEffectsCursor = jest.fn();
const mockEffectsLimit = jest.fn();
const mockEffectsOrder = jest.fn();
const mockEffectsForAccount = jest.fn();
const mockEffectsStream = jest.fn((handlers: typeof streamHandlers) => {
  streamHandlers = handlers;
  return () => {};
});

function makeEffectsBuilder() {
  const builder: Record<string, unknown> = {};
  builder.forAccount = (...args: unknown[]) => {
    mockEffectsForAccount(...args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    mockEffectsOrder(...args);
    return builder;
  };
  builder.limit = (...args: unknown[]) => {
    mockEffectsLimit(...args);
    return builder;
  };
  builder.cursor = (...args: unknown[]) => {
    mockEffectsCursor(...args);
    return builder;
  };
  builder.call = mockEffectsCall;
  builder.stream = mockEffectsStream;
  return builder;
}

const mockEffects = jest.fn(makeEffectsBuilder);
const mockHorizonServerConstructor = jest.fn().mockImplementation(() => ({
  effects: mockEffects,
}));

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: mockHorizonServerConstructor,
  },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));

const { useAccountEffects } =
  await import("../../src/templates/default/src/hooks/useAccountEffects.js");

function makeEffect(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `eff-${index}`,
    paging_token: `pt-${index}`,
    account: VALID_PUBLIC_KEY,
    type: "trade",
    type_i: 33,
    created_at: "2026-01-01T00:00:00Z",
    seller: VALID_PUBLIC_KEY_2,
    offer_id: `${1000 + index}`,
    sold_amount: "10.0000000",
    sold_asset_type: "native",
    bought_amount: "2.5000000",
    bought_asset_type: "credit_alphanum4",
    bought_asset_code: "USDC",
    bought_asset_issuer: VALID_PUBLIC_KEY_2,
    ...overrides,
  };
}

function makeEffectPage(start: number, count: number) {
  return Array.from({ length: count }, (_, idx) => makeEffect(start + idx));
}

describe("useAccountEffects (Template Hook)", () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let consoleWarnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();
    streamHandlers = {};
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("fetches initial account effects and returns typed records", async () => {
    const records = [
      makeEffect(0, { type: "trade", type_i: 33 }),
      makeEffect(1, {
        type: "trustline_created",
        type_i: 20,
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: VALID_PUBLIC_KEY_2,
        limit: "10000.0000000",
      }),
      makeEffect(2, {
        type: "signer_created",
        type_i: 10,
        weight: 1,
        public_key: VALID_PUBLIC_KEY_2,
        key: VALID_PUBLIC_KEY_2,
      }),
    ];
    mockEffectsCall.mockResolvedValueOnce({ records });

    const { result } = renderHook(() =>
      useAccountEffects(VALID_PUBLIC_KEY, { pageSize: 10 }),
    );
    await flush();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.effects).toHaveLength(3);
    expect(result.current.effects[0].type).toBe("trade");
    expect(result.current.effects[1].type).toBe("trustline_created");
    expect(result.current.effects[2].type).toBe("signer_created");
    expect(result.current.hasMore).toBe(false);
    expect(result.current.networkPassphrase).toBe(
      "Test SDF Network ; September 2015",
    );
    expect(mockEffectsForAccount).toHaveBeenCalledWith(VALID_PUBLIC_KEY);
    expect(mockEffectsOrder).toHaveBeenCalledWith("desc");
    expect(mockEffectsLimit).toHaveBeenCalledWith(10);
  });

  it("supports PUBLIC network passphrase option", async () => {
    mockEffectsCall.mockResolvedValueOnce({ records: [] });

    const { result } = renderHook(() =>
      useAccountEffects(VALID_PUBLIC_KEY, {
        horizonUrl: "https://horizon.stellar.org",
        network: "PUBLIC",
      }),
    );
    await flush();

    expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
      "https://horizon.stellar.org",
    );
    expect(result.current.networkPassphrase).toBe(
      "Public Global Stellar Network ; September 2015",
    );
  });

  it("paginates with cursor and deduplicates boundary records", async () => {
    const page1 = makeEffectPage(0, 3);
    mockEffectsCall.mockResolvedValueOnce({ records: page1 });

    const { result } = renderHook(() =>
      useAccountEffects(VALID_PUBLIC_KEY, { pageSize: 3 }),
    );
    await flush();

    expect(result.current.effects).toHaveLength(3);
    expect(result.current.hasMore).toBe(true);

    // Next page re-includes boundary record eff-2 plus two new records
    const page2 = [page1[2], ...makeEffectPage(3, 2)];
    mockEffectsCall.mockResolvedValueOnce({ records: page2 });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(mockEffectsCursor).toHaveBeenCalledWith("pt-2");
    expect(result.current.effects).toHaveLength(5);
    expect(result.current.effects.map((e) => e.id)).toEqual([
      "eff-0",
      "eff-1",
      "eff-2",
      "eff-3",
      "eff-4",
    ]);
  });

  it("streams live updates via useHorizonStreaming when enableStreaming is true", async () => {
    mockEffectsCall.mockResolvedValueOnce({ records: makeEffectPage(0, 1) });

    const { result } = renderHook(() =>
      useAccountEffects(VALID_PUBLIC_KEY, {
        pageSize: 5,
        enableStreaming: true,
      }),
    );
    await flush();

    expect(result.current.streaming).toBe(true);
    expect(mockEffectsStream).toHaveBeenCalled();

    mockEffectsCall.mockResolvedValueOnce({ records: makeEffectPage(10, 2) });
    await act(async () => {
      streamHandlers.onmessage?.();
    });
    await flush();

    expect(result.current.effects).toHaveLength(2);
    expect(result.current.effects[0].id).toBe("eff-10");
  });

  it("returns empty effects without calling Horizon when publicKey is null", async () => {
    const { result } = renderHook(() => useAccountEffects(null));
    await flush();

    expect(result.current.effects).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockEffectsCall).not.toHaveBeenCalled();
  });

  it("treats 404 (unfunded account) as empty effects with no error", async () => {
    const notFoundError = Object.assign(new Error("Account not found"), {
      response: { status: 404 },
      name: "NotFoundError",
    });
    mockEffectsCall.mockRejectedValueOnce(notFoundError);

    const { result } = renderHook(() => useAccountEffects(VALID_PUBLIC_KEY));
    await flush();

    expect(result.current.effects).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("sets error for invalid public keys (failure mode 1)", async () => {
    const { result: shortResult } = renderHook(() =>
      useAccountEffects(INVALID_PUBLIC_KEY_SHORT),
    );
    await flush();

    expect(shortResult.current.error).toBeInstanceOf(Error);
    expect(shortResult.current.error?.message).toContain(
      "Invalid Stellar public key",
    );

    const { result: noGResult } = renderHook(() =>
      useAccountEffects(INVALID_PUBLIC_KEY_NO_G),
    );
    await flush();

    expect(noGResult.current.error).toBeInstanceOf(Error);
    expect(noGResult.current.error?.message).toContain(
      "Invalid Stellar public key",
    );
  });

  it("sets error on Horizon 500 / network failure (failure mode 2)", async () => {
    mockEffectsCall.mockRejectedValueOnce(
      Object.assign(new Error("fetch failed"), {
        response: { status: 500 },
      }),
    );

    const { result } = renderHook(() => useAccountEffects(VALID_PUBLIC_KEY));
    await flush();

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain("Network error");
    expect(result.current.loading).toBe(false);
  });

  it("sets error on Horizon 400 client error and preserves prior effects on fetchNextPage failure (failure mode 3)", async () => {
    mockEffectsCall.mockResolvedValueOnce({ records: makeEffectPage(0, 2) });

    const { result } = renderHook(() =>
      useAccountEffects(VALID_PUBLIC_KEY, { pageSize: 2 }),
    );
    await flush();
    expect(result.current.effects).toHaveLength(2);

    mockEffectsCall.mockRejectedValueOnce(
      Object.assign(new Error("Bad cursor"), {
        response: { status: 400 },
      }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.effects).toHaveLength(2);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain("Client error");
  });
});
