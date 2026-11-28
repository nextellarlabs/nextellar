/**
 * @jest-environment jsdom
 */
import { StellarToml } from "@stellar/stellar-sdk";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSep30Recovery as useDefaultSep30Recovery } from "../../src/templates/default/src/hooks/useSep30Recovery";
import { useSep30Recovery } from "../../src/templates/defi/src/hooks/useSep30Recovery";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

describe("useSep30Recovery (#1227)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    (global.fetch as unknown) = jest.fn();
  });

  it("discovers the recovery server from stellar.toml", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: "https://recovery.example.com",
      SIGNING_KEY: "GSIGNINGKEY",
    } as never);

    const { result } = renderHook(() => useSep30Recovery());

    let server;
    await act(async () => {
      server = await result.current.discover("example.com");
    });

    expect(server).toEqual({
      serverUrl: "https://recovery.example.com",
      signingKey: "GSIGNINGKEY",
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error when stellar.toml is missing RECOVERY_SIGNER", async () => {
    mockResolve.mockResolvedValue({} as never);

    const { result } = renderHook(() => useSep30Recovery());

    await act(async () => {
      await expect(result.current.discover("example.com")).rejects.toThrow(
        /RECOVERY_SIGNER/,
      );
    });

    expect(result.current.error?.message).toMatch(/RECOVERY_SIGNER/);
    expect(result.current.loading).toBe(false);
  });

  it("registers recovery signers against an explicit serverUrl", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() => useSep30Recovery());

    await act(async () => {
      await result.current.register({
        accountId: "GACCOUNT",
        authToken: "jwt",
        signers: ["GSIGNER1", "GSIGNER2"],
        serverUrl: "https://recovery.example.com",
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://recovery.example.com/accounts/GACCOUNT/signers",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.error).toBeNull();
  });

  it("register rejects when neither serverUrl nor hook homeDomain is given", async () => {
    const { result } = renderHook(() => useSep30Recovery());

    await act(async () => {
      await expect(
        result.current.register({
          accountId: "GACCOUNT",
          authToken: "jwt",
          signers: ["GSIGNER1"],
        }),
      ).rejects.toThrow(/serverUrl or hook homeDomain is required/);
    });
  });

  it("recovers an account and returns the signed transaction", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ transaction: "signed-xdr" }),
    );

    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: "https://recovery.example.com" }),
    );

    let response;
    await act(async () => {
      response = await result.current.recover({
        accountId: "GACCOUNT",
        recoveryToken: "token-123",
      });
    });

    expect(response).toEqual({ transaction: "signed-xdr" });
    expect(result.current.loading).toBe(false);
  });

  it("recover falls back to discovering the server via homeDomain when no serverUrl is given", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: "https://discovered.example.com",
    } as never);
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ transaction: "signed-xdr" }),
    );

    const { result } = renderHook(() =>
      useSep30Recovery({ homeDomain: "example.com" }),
    );

    await act(async () => {
      await result.current.recover({
        accountId: "GACCOUNT",
        recoveryToken: "token-123",
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://discovered.example.com/accounts/GACCOUNT/recover",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a non-2xx recovery server response as an error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ message: "invalid recovery token" }, 400),
    );

    const { result } = renderHook(() =>
      useSep30Recovery({ serverUrl: "https://recovery.example.com" }),
    );

    await act(async () => {
      await expect(
        result.current.recover({
          accountId: "GACCOUNT",
          recoveryToken: "bad-token",
        }),
      ).rejects.toThrow(/SEP-30 request failed \(400\)/);
    });

    expect(result.current.error?.message).toMatch(/SEP-30 request failed/);
  });
});

describe("useSep30Recovery (default template)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    (global.fetch as unknown) = jest.fn();
  });

  it("completes the full discover -> register -> recover flow against a mocked recovery server", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: "https://recovery.example.com/",
      SIGNING_KEY: "GSIGNINGKEY",
    } as never);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ transaction: "AAAA-signed-xdr" }));

    const { result } = renderHook(() => useDefaultSep30Recovery());

    let discovered: { serverUrl: string; signingKey?: string } | undefined;
    await act(async () => {
      discovered = await result.current.discover("example.com");
    });

    expect(discovered).toEqual({
      serverUrl: "https://recovery.example.com/",
      signingKey: "GSIGNINGKEY",
    });

    await act(async () => {
      await result.current.register({
        accountId: "GACCOUNT",
        authToken: "sep10-jwt",
        signers: ["GSIGNER1", "GSIGNER2"],
        serverUrl: discovered!.serverUrl,
      });
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://recovery.example.com/accounts/GACCOUNT/signers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ signers: ["GSIGNER1", "GSIGNER2"] }),
      }),
    );

    const registerHeaders = (global.fetch as jest.Mock).mock.calls[0][1]
      .headers as Headers;
    expect(registerHeaders.get("Authorization")).toBe("Bearer sep10-jwt");
    expect(registerHeaders.get("Content-Type")).toBe("application/json");

    let recoveryResponse: { transaction: string } | undefined;
    await act(async () => {
      recoveryResponse = await result.current.recover({
        accountId: "GACCOUNT",
        recoveryToken: "recovery-token-abc",
        serverUrl: discovered!.serverUrl,
      });
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://recovery.example.com/accounts/GACCOUNT/recover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ recovery_token: "recovery-token-abc" }),
      }),
    );
    expect(recoveryResponse).toEqual({ transaction: "AAAA-signed-xdr" });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("register discovers serverUrl via hook homeDomain when no serverUrl is provided", async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: "https://discovered-reg.example.com",
    } as never);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() =>
      useDefaultSep30Recovery({ homeDomain: "example.com" }),
    );

    await act(async () => {
      await result.current.register({
        accountId: "GACCOUNT",
        authToken: "jwt-1",
        signers: ["GSIGNER1"],
      });
    });

    expect(mockResolve).toHaveBeenCalledWith("example.com", {
      allowHttp: undefined,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://discovered-reg.example.com/accounts/GACCOUNT/signers",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.error).toBeNull();
  });

  it("allows per-call serverUrl to override hook-level serverUrl", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

    const { result } = renderHook(() =>
      useDefaultSep30Recovery({ serverUrl: "https://default.example.com" }),
    );

    await act(async () => {
      await result.current.register({
        accountId: "GACCOUNT",
        authToken: "jwt-1",
        signers: ["GSIGNER1"],
        serverUrl: "https://override.example.com",
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://override.example.com/accounts/GACCOUNT/signers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("recover rejects when neither serverUrl nor hook homeDomain is given", async () => {
    const { result } = renderHook(() => useDefaultSep30Recovery());

    await act(async () => {
      await expect(
        result.current.recover({
          accountId: "GACCOUNT",
          recoveryToken: "token-123",
        }),
      ).rejects.toThrow(/serverUrl or hook homeDomain is required/);
    });
  });

  it("sets loading true during an in-flight request and false when done", async () => {
    let resolveFetch!: (value: Response) => void;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() =>
      useDefaultSep30Recovery({ serverUrl: "https://recovery.example.com" }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.register({
        accountId: "GACCOUNT",
        authToken: "jwt",
        signers: ["GSIGNER1"],
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      resolveFetch(jsonResponse({}));
      await pending;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces registration errors and clears error on a subsequent successful call", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ transaction: "recovered-xdr" }));

    const { result } = renderHook(() =>
      useDefaultSep30Recovery({ serverUrl: "https://recovery.example.com" }),
    );

    await act(async () => {
      await expect(
        result.current.register({
          accountId: "GACCOUNT",
          authToken: "bad-jwt",
          signers: ["GSIGNER1"],
        }),
      ).rejects.toThrow(/SEP-30 request failed \(401\)/);
    });

    expect(result.current.error?.message).toMatch(/401/);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      const res = await result.current.recover({
        accountId: "GACCOUNT",
        recoveryToken: "valid-token",
      });
      expect(res).toEqual({ transaction: "recovered-xdr" });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
