import {
  discoverSep38QuoteServer,
  fetchSep38FirmQuote,
  fetchSep38IndicativePrice,
  Sep38Error,
} from "../../src/templates/default/src/lib/sep38";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { StellarToml } from "@stellar/stellar-sdk";

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("sep38 (#1053)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    clearStellarTomlCache();
    global.fetch = jest.fn();
  });

  describe("discoverSep38QuoteServer", () => {
    it("resolves ANCHOR_QUOTE_SERVER from stellar.toml", async () => {
      mockResolve.mockResolvedValue({
        ANCHOR_QUOTE_SERVER: "https://quotes.example.org",
      } as never);

      const url = await discoverSep38QuoteServer("example.com");
      expect(url).toBe("https://quotes.example.org");
    });

    it("throws when ANCHOR_QUOTE_SERVER is missing", async () => {
      mockResolve.mockResolvedValue({} as never);

      await expect(discoverSep38QuoteServer("example.com")).rejects.toThrow(
        /ANCHOR_QUOTE_SERVER/,
      );
    });
  });

  describe("fetchSep38IndicativePrice", () => {
    it("requests an indicative price via GET and constructs the correct query", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          price: "1.25",
          sell_amount: "100",
          buy_amount: "80",
        }),
      );

      const result = await fetchSep38IndicativePrice({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
      });

      expect(result.kind).toBe("indicative");
      expect(result.price).toBe("1.25");
      expect(result.sellAmount).toBe("100");
      expect(result.buyAmount).toBe("80");

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain("https://quotes.example.org/price?");
      expect(url).toContain("sell_asset=iso4217%3AUSD");
      expect(url).toContain("sell_amount=100");
      expect(init.method).toBeUndefined();
    });

    it("throws when neither sellAmount nor buyAmount is provided", async () => {
      await expect(
        fetchSep38IndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          context: "sep6",
        }),
      ).rejects.toThrow(Sep38Error);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("throws Sep38Error on a non-2xx response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ error: "bad request" }, 400),
      );

      await expect(
        fetchSep38IndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        }),
      ).rejects.toThrow(Sep38Error);
    });

    it("throws Sep38Error on a network failure", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        fetchSep38IndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        }),
      ).rejects.toThrow(/ECONNRESET/);
    });

    it("throws Sep38Error on a malformed (non-JSON) response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
        text: async () => "not json",
      } as unknown as Response);

      await expect(
        fetchSep38IndicativePrice({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
        }),
      ).rejects.toThrow(Sep38Error);
    });
  });

  describe("fetchSep38FirmQuote", () => {
    it("requests a firm quote via POST with the authToken bearer header", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          id: "quote-123",
          expires_at: "2030-01-01T00:00:00Z",
          price: "1.25",
          sell_asset: "iso4217:USD",
          sell_amount: "100",
          buy_asset: "stellar:XLM:GISSUER",
          buy_amount: "80",
        }),
      );

      const result = await fetchSep38FirmQuote({
        quoteServer: "https://quotes.example.org",
        sellAsset: "iso4217:USD",
        buyAsset: "stellar:XLM:GISSUER",
        sellAmount: "100",
        context: "sep6",
        authToken: "jwt-token",
      });

      expect(result.kind).toBe("firm");
      expect(result.id).toBe("quote-123");
      expect(result.expiresAt).toBe("2030-01-01T00:00:00Z");

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("https://quotes.example.org/quote");
      expect(init.method).toBe("POST");
      expect(init.headers.get("Authorization")).toBe("Bearer jwt-token");
      const sentBody = JSON.parse(init.body);
      expect(sentBody.sell_asset).toBe("iso4217:USD");
      expect(sentBody.sell_amount).toBe("100");
    });

    it("throws when neither sellAmount nor buyAmount is provided", async () => {
      await expect(
        fetchSep38FirmQuote({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          context: "sep6",
          authToken: "jwt-token",
        }),
      ).rejects.toThrow(Sep38Error);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("throws when the server response is missing expires_at", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({
          id: "quote-123",
          price: "1.25",
          sell_asset: "iso4217:USD",
          sell_amount: "100",
          buy_asset: "stellar:XLM:GISSUER",
          buy_amount: "80",
        }),
      );

      await expect(
        fetchSep38FirmQuote({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
          authToken: "jwt-token",
        }),
      ).rejects.toThrow(/expires_at/);
    });

    it("throws Sep38Error on a non-2xx response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ error: "unauthorized" }, 401),
      );

      await expect(
        fetchSep38FirmQuote({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
          authToken: "bad-token",
        }),
      ).rejects.toThrow(Sep38Error);
    });

    it("does not leak the authToken into a thrown error message", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ error: "unauthorized" }, 401),
      );

      try {
        await fetchSep38FirmQuote({
          quoteServer: "https://quotes.example.org",
          sellAsset: "iso4217:USD",
          buyAsset: "stellar:XLM:GISSUER",
          sellAmount: "100",
          context: "sep6",
          authToken: "super-secret-jwt",
        });
        fail("expected fetchSep38FirmQuote to throw");
      } catch (err) {
        expect(String(err)).not.toContain("super-secret-jwt");
      }
    });
  });
});
