/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";

const { Keypair } = await import("@stellar/stellar-sdk");
const { useContractDeploy } =
  await import("../../src/templates/default/src/hooks/useContractDeploy");

describe("useContractDeploy (#1057)", () => {
  it("computes wasm hash and returns upload + deploy XDR", async () => {
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

    expect(deployResult.uploadXdr).toMatch(/^AAAA/);
    expect(deployResult.deployXdr).toMatch(/^AAAA/);
    expect(deployResult.wasmHash).toHaveLength(64);
    expect(deployResult.contractId.startsWith("C")).toBe(true);
  });

  it("surfaces a clear error when buildDeployXDR throws (#1273)", async () => {
    const { result } = renderHook(() =>
      useContractDeploy({ network: "TESTNET" }),
    );

    let thrown: unknown;
    await act(async () => {
      try {
        // Pass a null publicKey to force an internal error
        await result.current.buildDeployXDR({
          wasm: Buffer.from("wasm-bytes"),
          sourcePublicKey: "INVALID_KEY",
        });
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.loading).toBe(false);
  });
});
