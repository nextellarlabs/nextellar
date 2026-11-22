/**
 * @jest-environment jsdom
 *
 * Targets the js-template port of useSep30Recovery (#1242, plain JS, no
 * types). jest.config.mjs compiles the js-* templates' .js modules to CJS
 * specifically so this file's hook module loads under Jest. There is no TS
 * default-template hook test for useSep30Recovery yet (only its lib,
 * tests/lib/sep30.test.ts); this file is the first hook-level coverage.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { StellarToml } from "@stellar/stellar-sdk";
import { useSep30Recovery } from "../../src/templates/js-template/src/hooks/useSep30Recovery.js";

const SERVER_URL = "https://recovery.example.com";
const HOME_DOMAIN = "example.com";
const ACCOUNT_ID = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

// discoverSep30RecoveryServer resolves stellar.toml via the SDK's own
// resolver (axios-based), not the global `fetch` mocked below for the
// register/recover HTTP calls - so stellar.toml discovery is spied on
// directly, same as tests/lib/sep30.test.ts does for the TS lib.
const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("useSep30Recovery (js-template, #1242)", () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockResolve.mockReset();
  });

  it("starts idle with no error", () => {
    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: SERVER_URL }),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("register POSTs the signer list to the recovery server", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: SERVER_URL }),
    );

    await act(async () => {
      await result.current.register({
        accountId: ACCOUNT_ID,
        authToken: "jwt-token",
        signers: ["GSIGN1", "GSIGN2"],
      });
    });

    expect(result.current.error).toBeNull();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${SERVER_URL}/accounts/${ACCOUNT_ID}/signers`);
    expect(init.method).toBe("POST");
    expect(init.headers.get("Authorization")).toBe("Bearer jwt-token");
    expect(JSON.parse(init.body)).toEqual({ signers: ["GSIGN1", "GSIGN2"] });
  });

  it("register rejects when neither serverUrl nor homeDomain is configured", async () => {
    const { result } = renderHook(() => useSep30Recovery({}));

    let caught: Error | undefined;
    await act(async () => {
      try {
        await result.current.register({
          accountId: ACCOUNT_ID,
          authToken: "jwt",
          signers: ["GSIGN1"],
        });
      } catch (err) {
        caught = err as Error;
      }
    });

    expect(caught?.message).toMatch(/serverUrl or hook homeDomain is required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("register discovers the server from homeDomain when no serverUrl is given", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: SERVER_URL,
      SIGNING_KEY: "GGATEWAYKEY",
    } as never);
    mockFetch.mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() =>
      useSep30Recovery({ homeDomain: HOME_DOMAIN }),
    );

    await act(async () => {
      await result.current.register({
        accountId: ACCOUNT_ID,
        authToken: "jwt",
        signers: ["GSIGN1"],
      });
    });

    // The register POST must have gone to the DISCOVERED server, not a guess.
    const postCall = mockFetch.mock.calls.find(
      ([, init]: [string, RequestInit]) => init?.method === "POST",
    );
    expect(postCall?.[0]).toBe(`${SERVER_URL}/accounts/${ACCOUNT_ID}/signers`);
  });

  it("recover POSTs the recovery token and returns the signed transaction", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ transaction: "AAAAAgAAAAA=" }));

    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: SERVER_URL }),
    );

    let response: { transaction: string } | undefined;
    await act(async () => {
      response = await result.current.recover({
        accountId: ACCOUNT_ID,
        recoveryToken: "tok-123",
      });
    });

    expect(response?.transaction).toBe("AAAAAgAAAAA=");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${SERVER_URL}/accounts/${ACCOUNT_ID}/recover`);
    expect(JSON.parse(init.body)).toEqual({ recovery_token: "tok-123" });
  });

  it("recover rejects when neither serverUrl nor homeDomain is configured", async () => {
    const { result } = renderHook(() => useSep30Recovery({}));

    let caught: Error | undefined;
    await act(async () => {
      try {
        await result.current.recover({
          accountId: ACCOUNT_ID,
          recoveryToken: "tok-123",
        });
      } catch (err) {
        caught = err as Error;
      }
    });

    expect(caught?.message).toMatch(/serverUrl or hook homeDomain is required/);
  });

  it("discover resolves RECOVERY_SIGNER and SIGNING_KEY from stellar.toml", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: SERVER_URL,
      SIGNING_KEY: "GGATEWAYKEY",
    } as never);

    const { result } = renderHook(() => useSep30Recovery());

    let server: { serverUrl: string; signingKey?: string } | undefined;
    await act(async () => {
      server = await result.current.discover(HOME_DOMAIN);
    });

    expect(server?.serverUrl).toBe(SERVER_URL);
    expect(server?.signingKey).toBe("GGATEWAYKEY");
  });

  it("surfaces a non-ok register response as a clear Error, and sets loading back to false", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false, 401));

    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: SERVER_URL }),
    );

    let caught: Error | undefined;
    await act(async () => {
      try {
        await result.current.register({
          accountId: ACCOUNT_ID,
          authToken: "bad-jwt",
          signers: ["GSIGN1"],
        });
      } catch (err) {
        caught = err as Error;
      }
    });

    expect(caught?.message).toMatch(/SEP-30 request failed \(401\)/);
    expect(result.current.error?.message).toMatch(
      /SEP-30 request failed \(401\)/,
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("a successful call after a prior failure clears the stale error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: SERVER_URL }),
    );

    await act(async () => {
      try {
        await result.current.register({
          accountId: ACCOUNT_ID,
          authToken: "jwt",
          signers: ["GSIGN1"],
        });
      } catch {
        // expected
      }
    });
    expect(result.current.error).not.toBeNull();

    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await act(async () => {
      await result.current.register({
        accountId: ACCOUNT_ID,
        authToken: "jwt",
        signers: ["GSIGN1"],
      });
    });
    expect(result.current.error).toBeNull();
  });
});
