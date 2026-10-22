/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { StellarToml } from "@stellar/stellar-sdk";
import { useSep30Recovery } from "../../src/templates/default/src/hooks/useSep30Recovery";

const SERVER = "https://recovery.example.org";
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

describe("useSep30Recovery", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    global.fetch = jest.fn();
  });

  it("does not fetch on mount and starts idle", () => {
    const { result } = renderHook(() => useSep30Recovery());
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("discovers the recovery server from stellar.toml", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: SERVER,
      SIGNING_KEY: "G_SIGNER",
    } as never);
    const { result } = renderHook(() => useSep30Recovery());

    let server: unknown;
    await act(async () => {
      server = await result.current.discover("example.com");
    });

    expect(server).toEqual({ serverUrl: SERVER, signingKey: "G_SIGNER" });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("sets error when discovery fails (missing RECOVERY_SIGNER)", async () => {
    mockResolve.mockResolvedValue({} as never);
    const { result } = renderHook(() => useSep30Recovery());

    await act(async () => {
      await expect(result.current.discover("example.com")).rejects.toThrow(
        /missing RECOVERY_SIGNER/,
      );
    });

    expect(result.current.error?.message).toMatch(/missing RECOVERY_SIGNER/);
    expect(result.current.loading).toBe(false);
  });

  it("registers signers with POST, bearer auth and JSON body", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));

    await act(async () => {
      await result.current.register({
        accountId: "G_ACCOUNT",
        authToken: "jwt-token",
        signers: ["G_SIGNER_1", "G_SIGNER_2"],
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/accounts/G_ACCOUNT/signers`);
    expect(init.method).toBe("POST");
    expect(init.headers.get("Authorization")).toBe("Bearer jwt-token");
    expect(JSON.parse(init.body)).toEqual({
      signers: ["G_SIGNER_1", "G_SIGNER_2"],
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("prefers a per-call serverUrl over the hook option", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));

    await act(async () => {
      await result.current.register({
        accountId: "G_ACCOUNT",
        authToken: "t",
        signers: ["G1"],
        serverUrl: "https://other.example.org/",
      });
    });

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      "https://other.example.org/accounts/G_ACCOUNT/signers",
    );
  });

  it("recovers an account and returns the signed transaction", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ transaction: "AAAA..." }),
    );
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));

    let response: unknown;
    await act(async () => {
      response = await result.current.recover({
        accountId: "G_ACCOUNT",
        recoveryToken: "share-token",
      });
    });

    expect(response).toEqual({ transaction: "AAAA..." });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/accounts/G_ACCOUNT/recover`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ recovery_token: "share-token" });
    expect(result.current.error).toBeNull();
  });

  it("completes register then recover against the same mocked server", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ transaction: "XDR" }));
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));

    await act(async () => {
      await result.current.register({
        accountId: "G_ACCOUNT",
        authToken: "jwt",
        signers: ["G1"],
      });
    });
    let response: { transaction: string } | undefined;
    await act(async () => {
      response = await result.current.recover({
        accountId: "G_ACCOUNT",
        recoveryToken: "tok",
      });
    });

    expect(response?.transaction).toBe("XDR");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("discovers the server via homeDomain when no serverUrl is given", async () => {
    mockResolve.mockResolvedValue({ RECOVERY_SIGNER: SERVER } as never);
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ transaction: "XDR" }),
    );
    const { result } = renderHook(() =>
      useSep30Recovery({ homeDomain: "example.com" }),
    );

    await act(async () => {
      await result.current.recover({
        accountId: "G_ACCOUNT",
        recoveryToken: "tok",
      });
    });

    expect(mockResolve).toHaveBeenCalledWith(
      "example.com",
      expect.anything(),
    );
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      `${SERVER}/accounts/G_ACCOUNT/recover`,
    );
  });

  it("throws when neither serverUrl nor homeDomain is available", async () => {
    const { result } = renderHook(() => useSep30Recovery());

    await act(async () => {
      await expect(
        result.current.register({
          accountId: "G",
          authToken: "t",
          signers: [],
        }),
      ).rejects.toThrow(/serverUrl or hook homeDomain is required/);
      await expect(
        result.current.recover({ accountId: "G", recoveryToken: "t" }),
      ).rejects.toThrow(/serverUrl or hook homeDomain is required/);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces server errors from register and clears them on next success", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403))
      .mockResolvedValueOnce(jsonResponse({}));
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));
    const params = { accountId: "G", authToken: "bad", signers: ["G1"] };

    await act(async () => {
      await expect(result.current.register(params)).rejects.toThrow(
        /SEP-30 request failed \(403\)/,
      );
    });
    expect(result.current.error?.message).toMatch(/403/);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.register(params);
    });
    expect(result.current.error).toBeNull();
  });

  it("surfaces server errors from recover", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ error: "invalid token" }, 401),
    );
    const { result } = renderHook(() => useSep30Recovery({ serverUrl: SERVER }));

    await act(async () => {
      await expect(
        result.current.recover({ accountId: "G", recoveryToken: "bad" }),
      ).rejects.toThrow(/SEP-30 request failed \(401\)/);
    });

    expect(result.current.error?.message).toMatch(/401/);
    expect(result.current.loading).toBe(false);
  });
});
