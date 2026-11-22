import {
  assertSafeInteractiveUrl,
  buildSep24InteractiveUrl,
  discoverSep24TransferServer,
  fetchSep24Transaction,
  isSep24InteractiveComplete,
  isSep24Terminal,
  parseSep24Message,
  Sep24Error,
  startSep24Interactive,
} from "../../src/templates/default/src/lib/sep24";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { StellarToml } from "@stellar/stellar-sdk";

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const SERVER = "https://anchor.example.com/sep24";

describe("sep24 (#1051)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    clearStellarTomlCache();
  });

  describe("discoverSep24TransferServer", () => {
    it("reads TRANSFER_SERVER_SEP0024 from stellar.toml", async () => {
      mockResolve.mockResolvedValue({
        TRANSFER_SERVER_SEP0024: SERVER,
      } as never);
      await expect(
        discoverSep24TransferServer("anchor.example.com"),
      ).resolves.toBe(SERVER);
    });

    it("throws when the anchor does not support SEP-24", async () => {
      mockResolve.mockResolvedValue({ TRANSFER_SERVER: "https://x" } as never);
      await expect(
        discoverSep24TransferServer("anchor.example.com"),
      ).rejects.toThrow(/missing TRANSFER_SERVER_SEP0024/);
    });
  });

  describe("startSep24Interactive", () => {
    it("POSTs to the interactive endpoint with the JWT and returns url + id", async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        jsonResponse({
          type: "interactive_customer_info_needed",
          url: "https://anchor.example.com/kyc?token=abc",
          id: "tx-1",
        }),
      );

      const res = await startSep24Interactive({
        transferServer: `${SERVER}/`,
        kind: "deposit",
        authToken: "jwt",
        assetCode: "USDC",
        account: "GABC",
        amount: "10",
        extra: { claimable_balance_supported: "true" },
        fetchImpl,
      });

      expect(res).toEqual({
        type: "interactive_customer_info_needed",
        url: "https://anchor.example.com/kyc?token=abc",
        id: "tx-1",
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe(`${SERVER}/transactions/deposit/interactive`);
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer jwt");
      expect(JSON.parse(init.body)).toEqual({
        asset_code: "USDC",
        account: "GABC",
        amount: "10",
        claimable_balance_supported: "true",
      });
    });

    it("surfaces the anchor's error message with the HTTP status", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: "asset not supported" }, 400));
      const err = await startSep24Interactive({
        transferServer: SERVER,
        kind: "withdraw",
        authToken: "jwt",
        assetCode: "XYZ",
        fetchImpl,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Sep24Error);
      expect(err.message).toMatch(/asset not supported/);
      expect(err.status).toBe(400);
    });

    it.each([
      [{ type: "customer_info_status", url: "https://a", id: "1" }],
      [{ type: "interactive_customer_info_needed", id: "1" }],
      [
        {
          type: "interactive_customer_info_needed",
          url: "javascript:alert(1)",
          id: "1",
        },
      ],
      [
        {
          type: "interactive_customer_info_needed",
          url: "http://anchor.example.com/x",
          id: "1",
        },
      ],
    ])("rejects an unusable anchor response %j", async (body) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(body));
      await expect(
        startSep24Interactive({
          transferServer: SERVER,
          kind: "deposit",
          authToken: "jwt",
          assetCode: "USDC",
          fetchImpl,
        }),
      ).rejects.toBeInstanceOf(Sep24Error);
    });

    it("validates its inputs before making a request", async () => {
      const fetchImpl = jest.fn();
      await expect(
        startSep24Interactive({
          transferServer: SERVER,
          kind: "swap" as never,
          authToken: "jwt",
          assetCode: "USDC",
          fetchImpl,
        }),
      ).rejects.toThrow(/kind/);
      await expect(
        startSep24Interactive({
          transferServer: SERVER,
          kind: "deposit",
          authToken: "",
          assetCode: "USDC",
          fetchImpl,
        }),
      ).rejects.toThrow(/authToken/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("URL helpers", () => {
    it("appends callback=postMessage and lang, keeping existing params", () => {
      const url = new URL(
        buildSep24InteractiveUrl("https://anchor.example.com/kyc?token=abc", {
          lang: "es",
        }),
      );
      expect(url.searchParams.get("token")).toBe("abc");
      expect(url.searchParams.get("callback")).toBe("postMessage");
      expect(url.searchParams.get("lang")).toBe("es");
    });

    it("allows http only for localhost", () => {
      expect(
        assertSafeInteractiveUrl("http://localhost:8000/kyc").hostname,
      ).toBe("localhost");
      expect(() => assertSafeInteractiveUrl("http://evil.example/kyc")).toThrow(
        Sep24Error,
      );
      expect(() => assertSafeInteractiveUrl("data:text/html,hi")).toThrow(
        Sep24Error,
      );
      expect(() => assertSafeInteractiveUrl("not a url")).toThrow(Sep24Error);
    });
  });

  describe("fetchSep24Transaction", () => {
    it("GETs /transaction with the id and JWT", async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ transaction: { id: "tx 1", status: "completed" } }),
        );
      const tx = await fetchSep24Transaction({
        transferServer: SERVER,
        authToken: "jwt",
        id: "tx 1",
        fetchImpl,
      });
      expect(tx.status).toBe("completed");
      expect(fetchImpl.mock.calls[0][0]).toBe(
        `${SERVER}/transaction?id=tx%201`,
      );
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
        "Bearer jwt",
      );
    });

    it("throws on HTTP errors and malformed bodies", async () => {
      await expect(
        fetchSep24Transaction({
          transferServer: SERVER,
          authToken: "jwt",
          id: "x",
          fetchImpl: jest
            .fn()
            .mockResolvedValue(jsonResponse({ error: "not found" }, 404)),
        }),
      ).rejects.toThrow(/not found/);
      await expect(
        fetchSep24Transaction({
          transferServer: SERVER,
          authToken: "jwt",
          id: "x",
          fetchImpl: jest.fn().mockResolvedValue(jsonResponse({})),
        }),
      ).rejects.toThrow(/missing `transaction`/);
    });
  });

  describe("parseSep24Message", () => {
    const expected = {
      origin: "https://anchor.example.com",
      transactionId: "tx-1",
    };

    it("accepts a matching message (object or JSON string)", () => {
      const data = {
        transaction: { id: "tx-1", status: "pending_user_transfer_start" },
      };
      expect(
        parseSep24Message({ origin: expected.origin, data }, expected)?.status,
      ).toBe("pending_user_transfer_start");
      expect(
        parseSep24Message(
          { origin: expected.origin, data: JSON.stringify(data) },
          expected,
        )?.id,
      ).toBe("tx-1");
    });

    it.each([
      [
        "another origin",
        {
          origin: "https://evil.example",
          data: { transaction: { id: "tx-1", status: "completed" } },
        },
      ],
      [
        "another transaction",
        {
          origin: "https://anchor.example.com",
          data: { transaction: { id: "tx-2", status: "completed" } },
        },
      ],
      [
        "no transaction",
        { origin: "https://anchor.example.com", data: { hello: "world" } },
      ],
      ["bad JSON", { origin: "https://anchor.example.com", data: "{oops" }],
      [
        "missing status",
        {
          origin: "https://anchor.example.com",
          data: { transaction: { id: "tx-1" } },
        },
      ],
      ["null data", { origin: "https://anchor.example.com", data: null }],
    ])("ignores %s", (_label, event) => {
      expect(parseSep24Message(event, expected)).toBeNull();
    });
  });

  it("classifies statuses", () => {
    expect(isSep24Terminal("completed")).toBe(true);
    expect(isSep24Terminal("pending_anchor")).toBe(false);
    expect(isSep24Terminal(undefined)).toBe(false);
    expect(isSep24InteractiveComplete("incomplete")).toBe(false);
    expect(isSep24InteractiveComplete("pending_user_transfer_start")).toBe(
      true,
    );
    expect(isSep24InteractiveComplete("error")).toBe(true);
  });
});
