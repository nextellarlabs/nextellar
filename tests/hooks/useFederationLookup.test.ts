/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { StellarToml } from "@stellar/stellar-sdk";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { useFederationLookup } from "../../src/templates/default/src/hooks/useFederationLookup";

const ACCOUNT = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

const fetchImpl = jest.fn(async (url: string) => {
  const q = new URL(url).searchParams.get("q");
  if (q === "alice*example.com") {
    return jsonResponse({
      stellar_address: q,
      account_id: ACCOUNT,
      memo_type: "id",
      memo: "77",
    });
  }
  return jsonResponse({}, 404);
});

describe("useFederationLookup (#950)", () => {
  beforeEach(() => {
    fetchImpl.mockClear();
    mockResolve.mockReset();
    clearStellarTomlCache();
    mockResolve.mockResolvedValue({
      FEDERATION_SERVER: "https://fed.example.com",
    } as never);
  });

  it.each(["", ACCOUNT, "not-federation"])("stays idle for %p", (input) => {
    const { result } = renderHook(() =>
      useFederationLookup(input, { fetchImpl, debounceMs: 0 }),
    );
    expect(result.current).toEqual({
      status: "idle",
      record: null,
      error: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a malformed federation address without a network call", () => {
    const { result } = renderHook(() =>
      useFederationLookup("alice*", { fetchImpl, debounceMs: 0 }),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(
      '"alice*" is not a valid federation address.',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves the account id and required memo", async () => {
    const { result } = renderHook(() =>
      useFederationLookup("alice*example.com", { fetchImpl, debounceMs: 0 }),
    );
    expect(result.current.status).toBe("resolving");

    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.record).toEqual({
      stellarAddress: "alice*example.com",
      accountId: ACCOUNT,
      memo: { type: "id", value: "77" },
    });
  });

  it("maps a not-found address to a clear message", async () => {
    const { result } = renderHook(() =>
      useFederationLookup("ghost*example.com", { fetchImpl, debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "No Stellar account found for ghost*example.com.",
    );
  });

  it("maps a domain without federation support to a clear message", async () => {
    mockResolve.mockResolvedValue({} as never);
    const { result } = renderHook(() =>
      useFederationLookup("alice*nofed.com", { fetchImpl, debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "nofed.com does not support federation addresses.",
    );
  });

  it("debounces typing and only resolves the latest address", async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useFederationLookup(input, { fetchImpl, debounceMs: 30 }),
      {
        initialProps: { input: "ali*example.com" },
      },
    );
    rerender({ input: "alic*example.com" });
    rerender({ input: "alice*example.com" });

    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("q")).toBe(
      "alice*example.com",
    );
  });

  it("clears the result when the input changes back to a plain key", async () => {
    const { result, rerender } = renderHook(
      ({ input }) => useFederationLookup(input, { fetchImpl, debounceMs: 0 }),
      {
        initialProps: { input: "alice*example.com" },
      },
    );
    await waitFor(() => expect(result.current.status).toBe("resolved"));
    rerender({ input: ACCOUNT });
    expect(result.current).toEqual({
      status: "idle",
      record: null,
      error: null,
    });
  });
});
