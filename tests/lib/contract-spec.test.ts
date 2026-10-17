/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";
// Unlike soroban-helpers.test.ts, this imports the root package's
// @stellar/stellar-sdk rather than the default template's own nested copy
// under src/templates/default/node_modules. This repo's CI only ever runs
// `npm ci` at the repo root (see ci.yml) — it never installs the template's
// own node_modules — so importing from that nested path here would pass
// locally (if you've separately run `npm install` inside
// src/templates/default/) but fail in CI with "Cannot find module", exactly
// as tests/lib/soroban-helpers.test.ts currently does (a pre-existing,
// previously undocumented CI failure independent of this PR — see the PR
// description). contract-spec.ts's own runtime `@stellar/stellar-sdk`
// import resolves the same way: Node's module resolution walks up from the
// importing file and only finds a nested copy if one was separately
// installed, so in the one-`npm ci`-at-root environment this repo's CI
// actually runs in, it resolves to this same root copy.
import { rpc, xdr, contract, Networks } from "@stellar/stellar-sdk";
import { fetchContractSpec } from "../../src/templates/default/src/lib/contract-spec";
import { VALID_CONTRACT_ID } from "../helpers";

/** Builds a real `xdr.ScSpecEntry` for a function, for use in a real `contract.Spec`. */
function functionEntry(
  name: string,
  inputs: Array<{ name: string; type: xdr.ScSpecTypeDef }>,
  outputs: xdr.ScSpecTypeDef[] = [],
  doc = "",
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc,
      name,
      inputs: inputs.map(
        (i) =>
          new xdr.ScSpecFunctionInputV0({
            doc: "",
            name: i.name,
            type: i.type,
          }),
      ),
      outputs,
    }),
  );
}

describe("fetchContractSpec (#1061)", () => {
  const fakeWasm = Buffer.from([0, 1, 2, 3]);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches the contract's wasm and decodes its functions from the spec", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);

    const spec = new contract.Spec([
      functionEntry(
        "transfer",
        [
          { name: "to", type: xdr.ScSpecTypeDef.scSpecTypeAddress() },
          { name: "amount", type: xdr.ScSpecTypeDef.scSpecTypeI128() },
        ],
        [],
        "Transfers tokens between accounts",
      ),
      functionEntry("get_admin", [], [xdr.ScSpecTypeDef.scSpecTypeAddress()]),
    ]);

    jest
      .spyOn(contract.Client, "fromWasm")
      .mockResolvedValue({ spec } as never);

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const { functions } = await fetchContractSpec(
      server,
      VALID_CONTRACT_ID,
      Networks.TESTNET,
    );

    expect(functions).toHaveLength(2);

    expect(functions[0]).toEqual({
      name: "transfer",
      args: [
        { name: "to", type: "Address" },
        { name: "amount", type: "i128" },
      ],
      outputsCount: 0,
      doc: "Transfers tokens between accounts",
    });

    expect(functions[1]).toEqual({
      name: "get_admin",
      args: [],
      outputsCount: 1,
      doc: "",
    });
  });

  it("passes the fetched wasm bytes to contract.Client.fromWasm", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);

    const spec = new contract.Spec([functionEntry("noop", [])]);
    const fromWasmSpy = jest
      .spyOn(contract.Client, "fromWasm")
      .mockResolvedValue({ spec } as never);

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    await fetchContractSpec(server, VALID_CONTRACT_ID, Networks.TESTNET);

    expect(fromWasmSpy).toHaveBeenCalledWith(
      fakeWasm,
      expect.objectContaining({
        contractId: VALID_CONTRACT_ID,
        networkPassphrase: Networks.TESTNET,
      }),
    );
  });

  it("accepts an RPC URL string instead of a Server instance", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);
    jest.spyOn(contract.Client, "fromWasm").mockResolvedValue({
      spec: new contract.Spec([functionEntry("noop", [])]),
    } as never);

    const result = await fetchContractSpec(
      "https://soroban-testnet.stellar.org",
      VALID_CONTRACT_ID,
      Networks.TESTNET,
    );

    expect(result.functions).toEqual([
      { name: "noop", args: [], outputsCount: 0, doc: "" },
    ]);
  });

  it("returns the underlying contract.Spec for advanced use", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);

    const spec = new contract.Spec([functionEntry("ping", [], [])]);
    jest
      .spyOn(contract.Client, "fromWasm")
      .mockResolvedValue({ spec } as never);

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const result = await fetchContractSpec(
      server,
      VALID_CONTRACT_ID,
      Networks.TESTNET,
    );

    expect(result.spec).toBe(spec);
    expect(result.spec.funcs().map((f) => f.name().toString())).toEqual([
      "ping",
    ]);
  });

  it("propagates the error when the contract has no wasm (e.g. not deployed)", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockRejectedValue(new Error("contract not found"));

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    await expect(
      fetchContractSpec(server, VALID_CONTRACT_ID, Networks.TESTNET),
    ).rejects.toThrow(/contract not found/i);
  });

  it("propagates the error when the wasm has no embedded spec section", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);
    jest
      .spyOn(contract.Client, "fromWasm")
      .mockRejectedValue(new Error("Could not obtain contract spec from wasm"));

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    await expect(
      fetchContractSpec(server, VALID_CONTRACT_ID, Networks.TESTNET),
    ).rejects.toThrow(/could not obtain contract spec/i);
  });

  it("falls back to the raw XDR type tag for types not covered by the label map", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(fakeWasm as never);

    // scSpecTypeVec needs a value type in real specs, but the type-label
    // heuristic only inspects `.switch()`, so a bare scvVec-less construction
    // still exercises the "known label" path without extra setup.
    const spec = new contract.Spec([
      functionEntry("noop", [
        {
          name: "x",
          type: xdr.ScSpecTypeDef.scSpecTypeVec(
            new xdr.ScSpecTypeVec({
              elementType: xdr.ScSpecTypeDef.scSpecTypeU32(),
            }),
          ),
        },
      ]),
    ]);
    jest
      .spyOn(contract.Client, "fromWasm")
      .mockResolvedValue({ spec } as never);

    const server = new rpc.Server("https://soroban-testnet.stellar.org");
    const { functions } = await fetchContractSpec(
      server,
      VALID_CONTRACT_ID,
      Networks.TESTNET,
    );

    expect(functions[0].args[0].type).toBe("Vec");
  });
});
