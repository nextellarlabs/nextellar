import { StellarToml } from "@stellar/stellar-sdk";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import {
  isFederationAddress,
  resolveFederationAddress,
  Sep2Error,
  splitFederationAddress,
} from "../../src/templates/default/src/lib/sep2";

const ACCOUNT = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const FED_SERVER = "https://fed.example.com/federation";

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/** A mocked SEP-2 federation server that knows a few records. */
function federationServer(records: Record<string, Record<string, unknown>>) {
  return jest.fn(async (url: string) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    const record = records[q];
    return record
      ? jsonResponse(record)
      : jsonResponse({ detail: "not found" }, 404);
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const err = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(Sep2Error);
  expect(err.code).toBe(code);
}

describe("sep2 federation (#950)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    clearStellarTomlCache();
    mockResolve.mockResolvedValue({ FEDERATION_SERVER: FED_SERVER } as never);
  });

  describe("address parsing", () => {
    it.each([
      "alice*example.com",
      "first.last*sub.example.org",
      "a+b@x*example.io",
    ])("recognises %s", (value) => {
      expect(isFederationAddress(value)).toBe(true);
    });

    it.each([
      "alice",
      "alice*",
      "*example.com",
      "alice*localhost",
      "al ice*example.com",
      "a*b*example.com",
      ACCOUNT,
    ])("rejects %s", (value) => {
      expect(isFederationAddress(value)).toBe(false);
    });

    it("lowercases the domain and keeps the name as typed", () => {
      expect(splitFederationAddress("  Alice*Example.COM ")).toEqual({
        name: "Alice",
        domain: "example.com",
      });
      expect(() => splitFederationAddress("bad")).toThrow(Sep2Error);
    });
  });

  it("resolves name*domain to an account id via stellar.toml FEDERATION_SERVER", async () => {
    const fetchImpl = federationServer({
      "alice*example.com": {
        stellar_address: "alice*example.com",
        account_id: ACCOUNT,
      },
    });

    await expect(
      resolveFederationAddress("alice*Example.com", { fetchImpl }),
    ).resolves.toEqual({
      stellarAddress: "alice*example.com",
      accountId: ACCOUNT,
      memo: undefined,
    });

    expect(mockResolve.mock.calls[0][0]).toBe("example.com");
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(FED_SERVER);
    expect(url.searchParams.get("q")).toBe("alice*example.com");
    expect(url.searchParams.get("type")).toBe("name");
  });

  it.each([
    [
      { memo_type: "text", memo: "user-42" },
      { type: "text", value: "user-42" },
    ],
    [
      { memo_type: "id", memo: "123456789" },
      { type: "id", value: "123456789" },
    ],
    // SEP-2 sends hash memos base64-encoded; they are converted to hex.
    [
      { memo_type: "hash", memo: Buffer.alloc(32, 0xab).toString("base64") },
      { type: "hash", value: "ab".repeat(32) },
    ],
    [
      { memo_type: "hash", memo: "CD".repeat(32) },
      { type: "hash", value: "cd".repeat(32) },
    ],
  ])("returns the required memo %p", async (memoFields, expected) => {
    const fetchImpl = federationServer({
      "bob*example.com": {
        stellar_address: "bob*example.com",
        account_id: ACCOUNT,
        ...memoFields,
      },
    });
    const record = await resolveFederationAddress("bob*example.com", {
      fetchImpl,
    });
    expect(record.memo).toEqual(expected);
  });

  describe("error states", () => {
    it("NOT_FOUND when the server does not know the name", async () => {
      await expectCode(
        resolveFederationAddress("ghost*example.com", {
          fetchImpl: federationServer({}),
        }),
        "NOT_FOUND",
      );
    });

    it("SERVER_ERROR on a 5xx or a network failure", async () => {
      await expectCode(
        resolveFederationAddress("a*example.com", {
          fetchImpl: jest.fn().mockResolvedValue(jsonResponse({}, 500)),
        }),
        "SERVER_ERROR",
      );
      await expectCode(
        resolveFederationAddress("a*example.com", {
          fetchImpl: jest.fn().mockRejectedValue(new TypeError("fetch failed")),
        }),
        "SERVER_ERROR",
      );
    });

    it("NO_FEDERATION_SERVER when stellar.toml is missing, unreachable or lists an unsafe server", async () => {
      mockResolve.mockResolvedValueOnce({} as never);
      await expectCode(
        resolveFederationAddress("a*example.com", { fetchImpl: jest.fn() }),
        "NO_FEDERATION_SERVER",
      );

      clearStellarTomlCache();
      mockResolve.mockRejectedValueOnce(new Error("ENOTFOUND"));
      await expectCode(
        resolveFederationAddress("a*example.com", { fetchImpl: jest.fn() }),
        "NO_FEDERATION_SERVER",
      );

      clearStellarTomlCache();
      mockResolve.mockResolvedValueOnce({
        FEDERATION_SERVER: "http://fed.example.com",
      } as never);
      const fetchImpl = jest.fn();
      await expectCode(
        resolveFederationAddress("a*example.com", { fetchImpl }),
        "NO_FEDERATION_SERVER",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      [
        "an invalid account id",
        { stellar_address: "a*example.com", account_id: "GNOTAKEY" },
      ],
      [
        "a different address",
        { stellar_address: "mallory*example.com", account_id: ACCOUNT },
      ],
      [
        "a memo type without a memo",
        {
          stellar_address: "a*example.com",
          account_id: ACCOUNT,
          memo_type: "id",
        },
      ],
      [
        "an invalid id memo",
        {
          stellar_address: "a*example.com",
          account_id: ACCOUNT,
          memo_type: "id",
          memo: "12a",
        },
      ],
      [
        "an oversized text memo",
        {
          stellar_address: "a*example.com",
          account_id: ACCOUNT,
          memo_type: "text",
          memo: "x".repeat(40),
        },
      ],
      [
        "a hash memo of the wrong length",
        {
          stellar_address: "a*example.com",
          account_id: ACCOUNT,
          memo_type: "hash",
          memo: "AAAA",
        },
      ],
      [
        "an unsupported memo type",
        {
          stellar_address: "a*example.com",
          account_id: ACCOUNT,
          memo_type: "return",
          memo: "x",
        },
      ],
    ])("INVALID_RESPONSE for %s", async (_label, body) => {
      await expectCode(
        resolveFederationAddress("a*example.com", {
          fetchImpl: jest.fn().mockResolvedValue(jsonResponse(body)),
        }),
        "INVALID_RESPONSE",
      );
    });

    it("INVALID_RESPONSE for a non-JSON body", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      });
      await expectCode(
        resolveFederationAddress("a*example.com", { fetchImpl }),
        "INVALID_RESPONSE",
      );
    });

    it("TIMEOUT when the federation server hangs", async () => {
      const fetchImpl = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      await expectCode(
        resolveFederationAddress("a*example.com", { fetchImpl, timeoutMs: 20 }),
        "TIMEOUT",
      );
    });

    it("INVALID_ADDRESS before any network call for a malformed address", async () => {
      const fetchImpl = jest.fn();
      await expectCode(
        resolveFederationAddress("not-an-address", { fetchImpl }),
        "INVALID_ADDRESS",
      );
      expect(mockResolve).not.toHaveBeenCalled();
    });
  });
});
