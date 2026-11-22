/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useSep6 } from "../../src/templates/default/src/hooks/useSep6";

const SERVER = "https://anchor.example.org/sep6";
const ACCOUNT = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("useSep6 (#1049)", () => {
  let fetchImpl: jest.Mock;

  beforeEach(() => {
    fetchImpl = jest.fn();
  });

  const setup = (authToken?: string) =>
    renderHook(() => useSep6({ transferServer: SERVER, authToken, fetchImpl }));

  it("does not fetch on mount", () => {
    setup();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("getInfo loads /info into info", async () => {
    fetchImpl.mockResolvedValue(
      response({ deposit: { USDC: { enabled: true } }, withdraw: {} }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.getInfo();
    });

    expect(result.current.info?.deposit.USDC.enabled).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("deposit uses the configured anchor and token and stores the instructions", async () => {
    fetchImpl.mockResolvedValue(response({ id: "dep-1", how: "Wire funds" }));
    const { result } = setup("jwt");

    await act(async () => {
      await result.current.deposit({ assetCode: "USDC", account: ACCOUNT });
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(`${SERVER}/deposit?`);
    expect(init.headers.Authorization).toBe("Bearer jwt");
    expect(result.current.result).toMatchObject({
      kind: "deposit",
      id: "dep-1",
    });
    expect(result.current.needsCustomerInfo).toBe(false);
  });

  it("withdraw reports a KYC requirement through needsCustomerInfo, not error", async () => {
    fetchImpl.mockResolvedValue(
      response(
        {
          type: "non_interactive_customer_info_needed",
          fields: ["first_name"],
        },
        403,
      ),
    );
    const { result } = setup("jwt");

    await act(async () => {
      await result.current.withdraw({
        assetCode: "USDC",
        type: "bank_account",
      });
    });

    expect(result.current.result).toEqual({
      kind: "customer_info_needed",
      fields: ["first_name"],
    });
    expect(result.current.needsCustomerInfo).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("getTransaction stores the transaction", async () => {
    fetchImpl.mockResolvedValue(
      response({
        transaction: { id: "dep-1", kind: "deposit", status: "completed" },
      }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.getTransaction("dep-1");
    });

    expect(result.current.transaction?.status).toBe("completed");
  });

  it("surfaces anchor errors through error and rethrows them", async () => {
    fetchImpl.mockResolvedValue(response({ error: "invalid asset_code" }, 400));
    const { result } = setup();

    let thrown: unknown;
    await act(async () => {
      thrown = await result.current
        .deposit({ assetCode: "NOPE", account: ACCOUNT })
        .catch((e) => e);
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain("invalid asset_code");
    expect(result.current.result).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("ignores a stale response that resolves after a newer request", async () => {
    let resolveFirst: (r: Response) => void = () => {};
    fetchImpl
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce(response({ id: "second" }));
    const { result } = setup();

    let first: Promise<unknown>;
    await act(async () => {
      first = result.current.deposit({ assetCode: "USDC", account: ACCOUNT });
      await result.current.deposit({ assetCode: "USDC", account: ACCOUNT });
    });
    await act(async () => {
      resolveFirst(response({ id: "first" }));
      await first;
    });

    expect(result.current.result).toMatchObject({ id: "second" });
  });

  it("reset clears results and errors", async () => {
    fetchImpl.mockResolvedValue(response({ id: "dep-1" }));
    const { result } = setup();

    await act(async () => {
      await result.current.deposit({ assetCode: "USDC", account: ACCOUNT });
    });
    act(() => result.current.reset());

    expect(result.current.result).toBeUndefined();
    expect(result.current.info).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
