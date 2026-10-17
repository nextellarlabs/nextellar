/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSep38Quote } from "../../src/templates/default/src/hooks/useSep38Quote";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("useSep38Quote (#1053)", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("does not fetch on mount", () => {
    renderHook(() => useSep38Quote());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resolves an indicative price and stores it as quote", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ price: "1.25", sell_amount: "100", buy_amount: "80" }),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });
    });

    expect(result.current.quote?.kind).toBe("indicative");
    expect(result.current.quote?.price).toBe("1.25");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("resolves a firm quote and stores it as quote", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        id: "quote-1",
        expires_at: "2030-01-01T00:00:00Z",
        price: "1.25",
        sell_asset: "iso4217:USD",
        sell_amount: "100",
        buy_asset: "stellar:XLM:GISSUER",
        buy_amount: "80",
      }),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getFirmQuote({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
        authToken: "jwt-token",
      });
    });

    expect(result.current.quote?.kind).toBe("firm");
    expect((result.current.quote as { id: string }).id).toBe("quote-1");
  });

  it("does not confuse an indicative price for a firm quote", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ price: "1.25", sell_amount: "100", buy_amount: "80" }),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });
    });

    expect(result.current.quote?.kind).toBe("indicative");
    expect("id" in (result.current.quote ?? {})).toBe(false);
    expect("expiresAt" in (result.current.quote ?? {})).toBe(false);
  });

  it("sets loading true during the request and false after", async () => {
    let resolveFetch!: (v: Response) => void;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );

    const { result } = renderHook(() => useSep38Quote());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveFetch(
        jsonResponse({ price: "1.25", sell_amount: "100", buy_amount: "80" }),
      );
      await pending;
    });

    expect(result.current.loading).toBe(false);
  });

  it("sets error and rethrows on a failed request", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: "bad request" }, 400),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await expect(
        result.current.getIndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        }),
      ).rejects.toThrow();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("sets error on a malformed response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
      text: async () => "not json",
    } as unknown as Response);

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await expect(
        result.current.getIndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        }),
      ).rejects.toThrow();
    });

    expect(result.current.error).not.toBeNull();
  });

  it("refetches when request parameters change", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        jsonResponse({ price: "1.25", sell_amount: "100", buy_amount: "80" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ price: "1.30", sell_amount: "200", buy_amount: "154" }),
      );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });
    });
    expect(result.current.quote?.price).toBe("1.25");

    await act(async () => {
      await result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "200",
        context: "sep6",
      });
    });
    expect(result.current.quote?.price).toBe("1.30");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports isExpired for a firm quote whose expiresAt has passed", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        id: "quote-1",
        expires_at: "2000-01-01T00:00:00Z",
        price: "1.25",
        sell_asset: "iso4217:USD",
        sell_amount: "100",
        buy_asset: "stellar:XLM:GISSUER",
        buy_amount: "80",
      }),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getFirmQuote({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
        authToken: "jwt-token",
      });
    });

    expect(result.current.isExpired).toBe(true);
  });

  it("reports isExpired false for an indicative price (no expiry)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ price: "1.25", sell_amount: "100", buy_amount: "80" }),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current.getIndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });
    });

    expect(result.current.isExpired).toBe(false);
  });

  it("reset clears quote and error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: "bad request" }, 400),
    );

    const { result } = renderHook(() => useSep38Quote());

    await act(async () => {
      await result.current
        .getIndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        })
        .catch(() => {});
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.quote).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
