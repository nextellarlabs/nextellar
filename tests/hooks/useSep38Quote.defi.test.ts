/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useSep38Quote } from "../../src/templates/defi/src/hooks/useSep38Quote";

const QUOTE_SERVER = "https://anchor.example.com/sep38";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const BASE_PARAMS = {
  quoteServer: QUOTE_SERVER,
  sellAsset: "iso4217:USD",
  buyAsset: "stellar:USDC:GISSUER",
  sellAmount: "100",
  context: "sep6" as const,
};

describe("useSep38Quote ported to defi (#1228)", () => {
  it("fetches an indicative price via GET /price", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        price: "1.0",
        sell_amount: "100",
        buy_amount: "100",
      }),
    );
    const { result } = renderHook(() => useSep38Quote({ fetchImpl }));

    let price;
    await act(async () => {
      price = await result.current.getIndicativePrice(BASE_PARAMS);
    });

    expect(price).toEqual({
      kind: "indicative",
      sellAsset: BASE_PARAMS.sellAsset,
      buyAsset: BASE_PARAMS.buyAsset,
      price: "1.0",
      sellAmount: "100",
      buyAmount: "100",
    });
    expect(result.current.quote).toEqual(price);
    expect(result.current.loading).toBe(false);
    expect(result.current.isExpired).toBe(false);

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain(`${QUOTE_SERVER}/price?`);
  });

  it("fetches a firm quote via POST /quote and reports expiry", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        id: "quote-1",
        expires_at: "2020-01-01T00:00:00.000Z",
        price: "1.0",
        sell_asset: BASE_PARAMS.sellAsset,
        sell_amount: "100",
        buy_asset: BASE_PARAMS.buyAsset,
        buy_amount: "100",
      }),
    );
    const { result } = renderHook(() => useSep38Quote({ fetchImpl }));

    await act(async () => {
      await result.current.getFirmQuote({
        ...BASE_PARAMS,
        authToken: "jwt",
      });
    });

    expect(result.current.quote).toMatchObject({
      kind: "firm",
      id: "quote-1",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(result.current.isExpired).toBe(true);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt");
  });

  it("requires exactly one of sellAmount/buyAmount", async () => {
    const fetchImpl = jest.fn();
    const { result } = renderHook(() => useSep38Quote({ fetchImpl }));

    await act(async () => {
      await expect(
        result.current.getIndicativePrice({
          ...BASE_PARAMS,
          sellAmount: undefined,
        }),
      ).rejects.toThrow(/exactly one of sellAmount or buyAmount/);
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(
      /exactly one of sellAmount or buyAmount/,
    );
  });

  it("surfaces a non-2xx anchor response as an error", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ error: "unsupported asset pair" }, 400),
    );
    const { result } = renderHook(() => useSep38Quote({ fetchImpl }));

    await act(async () => {
      await expect(
        result.current.getIndicativePrice(BASE_PARAMS),
      ).rejects.toThrow(/SEP-38 request failed \(400\)/);
    });

    expect(result.current.error?.message).toMatch(/SEP-38 request failed/);
    expect(result.current.loading).toBe(false);
  });

  it("reset clears the quote and error", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ price: "1.0", sell_amount: "100", buy_amount: "100" }),
    );
    const { result } = renderHook(() => useSep38Quote({ fetchImpl }));

    await act(async () => {
      await result.current.getIndicativePrice(BASE_PARAMS);
    });
    expect(result.current.quote).toBeDefined();

    act(() => {
      result.current.reset();
    });

    expect(result.current.quote).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
