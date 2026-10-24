/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const uploadContractWasm = jest.fn(async () => Buffer.alloc(32, 1));

await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const sdk = await import("@stellar/stellar-sdk");
  return {
    ...sdk,
    rpc: {
      Server: jest.fn(() => ({ uploadContractWasm })),
    },
  };
});

const { Keypair } = await import("@stellar/stellar-sdk");
const { useContractDeploy } =
  await import("../../src/templates/default/src/hooks/useContractDeploy");

describe("useContractDeploy (#1057)", () => {
  beforeEach(() => {
    uploadContractWasm.mockClear();
  });

  it("uploads WASM and returns deploy XDR", async () => {
    const { result } = renderHook(() =>
      useContractDeploy({ network: "TESTNET" }),
    );
    const source = Keypair.random().publicKey();

    let deployResult!: Awaited<
      ReturnType<typeof result.current.buildDeployXDR>
    >;

    await act(async () => {
      deployResult = await result.current.buildDeployXDR({
        wasm: Buffer.from("wasm-bytes"),
        sourcePublicKey: source,
      });
    });

    expect(uploadContractWasm).toHaveBeenCalled();
    expect(deployResult.deployXdr).toMatch(/^AAAA/);
    expect(deployResult.wasmHash).toHaveLength(64);
    expect(deployResult.contractId.startsWith("C")).toBe(true);
  });

  it("surfaces a clear error when the RPC rejects an oversized WASM upload (#1273)", async () => {
    uploadContractWasm.mockRejectedValueOnce(
      new Error("transaction too large: exceeds max_contract_size"),
    );

    const { result } = renderHook(() =>
      useContractDeploy({ network: "TESTNET" }),
    );
    const source = Keypair.random().publicKey();

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.buildDeployXDR({
          wasm: Buffer.alloc(1024 * 1024, 1),
          sourcePublicKey: source,
        });
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/too large|max_contract_size/);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(
      /too large|max_contract_size/,
    );
    expect(result.current.loading).toBe(false);
  });
});
