/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";
// See contract-spec.test.ts for why this imports the root package's
// @stellar/stellar-sdk rather than the template's nested copy.
import { rpc, xdr, contract, Networks } from "@stellar/stellar-sdk";
import {
  fetchContractSpec,
  type ContractFunctionSpec,
} from "../../src/templates/default/src/lib/contract-spec";
import { validateArgValue } from "../../src/templates/default/src/components/ContractCallForm";
import { VALID_CONTRACT_ID } from "../helpers";

const T = xdr.ScSpecTypeDef;

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

/** Mocks the network layer so `fetchContractSpec` decodes `spec`. */
async function decode(spec: unknown): Promise<ContractFunctionSpec[]> {
  jest
    .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
    .mockResolvedValue(Buffer.from([0, 1, 2, 3]) as never);
  jest.spyOn(contract.Client, "fromWasm").mockResolvedValue({ spec } as never);

  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const { functions } = await fetchContractSpec(
    server,
    VALID_CONTRACT_ID,
    Networks.TESTNET,
  );
  return functions;
}

/** A fake spec whose function inputs carry arbitrary XDR type tags (for tags the SDK cannot build). */
function fakeSpecWithTypeTags(tags: string[]) {
  const text = (value: string) => ({ toString: () => value });
  return {
    funcs: () => [
      {
        name: () => text("probe"),
        inputs: () =>
          tags.map((tag, i) => ({
            name: () => text(`arg${i}`),
            type: () => ({ switch: () => ({ name: tag }) }),
          })),
        outputs: () => [],
        doc: () => text(""),
      },
    ],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

// Each scalar and container type the decoder labels, with real XDR type defs.
const TYPE_TABLE: Array<[string, () => xdr.ScSpecTypeDef]> = [
  ["bool", () => T.scSpecTypeBool()],
  ["void", () => T.scSpecTypeVoid()],
  ["u32", () => T.scSpecTypeU32()],
  ["i32", () => T.scSpecTypeI32()],
  ["u64", () => T.scSpecTypeU64()],
  ["i64", () => T.scSpecTypeI64()],
  ["Timepoint", () => T.scSpecTypeTimepoint()],
  ["Duration", () => T.scSpecTypeDuration()],
  ["u128", () => T.scSpecTypeU128()],
  ["i128", () => T.scSpecTypeI128()],
  ["u256", () => T.scSpecTypeU256()],
  ["i256", () => T.scSpecTypeI256()],
  ["Bytes", () => T.scSpecTypeBytes()],
  ["String", () => T.scSpecTypeString()],
  ["Symbol", () => T.scSpecTypeSymbol()],
  ["Address", () => T.scSpecTypeAddress()],
  [
    "Option",
    () =>
      T.scSpecTypeOption(
        new xdr.ScSpecTypeOption({ valueType: T.scSpecTypeU32() }),
      ),
  ],
  [
    "Vec",
    () =>
      T.scSpecTypeVec(
        new xdr.ScSpecTypeVec({ elementType: T.scSpecTypeU32() }),
      ),
  ],
  [
    "Map",
    () =>
      T.scSpecTypeMap(
        new xdr.ScSpecTypeMap({
          keyType: T.scSpecTypeSymbol(),
          valueType: T.scSpecTypeU32(),
        }),
      ),
  ],
  [
    "Tuple",
    () =>
      T.scSpecTypeTuple(
        new xdr.ScSpecTypeTuple({
          valueTypes: [T.scSpecTypeU32(), T.scSpecTypeBool()],
        }),
      ),
  ],
  ["BytesN", () => T.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n: 32 }))],
  [
    "Result",
    () =>
      T.scSpecTypeResult(
        new xdr.ScSpecTypeResult({
          okType: T.scSpecTypeU32(),
          errorType: T.scSpecTypeError(),
        }),
      ),
  ],
  ["Udt", () => T.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: "MyStruct" }))],
];

describe("contract spec decoding: function argument types", () => {
  it.each(TYPE_TABLE)("labels a %s argument", async (label, makeType) => {
    const spec = new contract.Spec([
      functionEntry("probe", [{ name: "x", type: makeType() }]),
    ]);

    const functions = await decode(spec);

    expect(functions[0].args).toEqual([{ name: "x", type: label }]);
  });

  it("labels a MuxedAddress argument", async () => {
    const functions = await decode(
      fakeSpecWithTypeTags(["scSpecTypeMuxedAddress"]),
    );

    expect(functions[0].args[0].type).toBe("MuxedAddress");
  });

  it("labels Val and Error arguments", async () => {
    const functions = await decode(
      fakeSpecWithTypeTags(["scSpecTypeVal", "scSpecTypeError"]),
    );

    expect(functions[0].args.map((a) => a.type)).toEqual(["Val", "Error"]);
  });

  it("falls back to the raw XDR tag for a type this version does not know", async () => {
    const functions = await decode(
      fakeSpecWithTypeTags(["scSpecTypeFutureThing"]),
    );

    expect(functions[0].args[0].type).toBe("scSpecTypeFutureThing");
  });

  it("keeps decoding the remaining arguments around an unknown one", async () => {
    const functions = await decode(
      fakeSpecWithTypeTags([
        "scSpecTypeU32",
        "scSpecTypeFutureThing",
        "scSpecTypeAddress",
      ]),
    );

    expect(functions[0].args.map((a) => a.type)).toEqual([
      "u32",
      "scSpecTypeFutureThing",
      "Address",
    ]);
  });
});

describe("contract spec decoding: entry kinds", () => {
  const structEntry = xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: "",
      lib: "",
      name: "Point",
      fields: [
        new xdr.ScSpecUdtStructFieldV0({
          doc: "",
          name: "x",
          type: T.scSpecTypeU32(),
        }),
      ],
    }),
  );
  const enumEntry = xdr.ScSpecEntry.scSpecEntryUdtEnumV0(
    new xdr.ScSpecUdtEnumV0({
      doc: "",
      lib: "",
      name: "Color",
      cases: [new xdr.ScSpecUdtEnumCaseV0({ doc: "", name: "Red", value: 0 })],
    }),
  );
  const errorEnumEntry = xdr.ScSpecEntry.scSpecEntryUdtErrorEnumV0(
    new xdr.ScSpecUdtErrorEnumV0({
      doc: "",
      lib: "",
      name: "Error",
      cases: [
        new xdr.ScSpecUdtErrorEnumCaseV0({ doc: "", name: "Failed", value: 1 }),
      ],
    }),
  );
  const unionEntry = xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
    new xdr.ScSpecUdtUnionV0({
      doc: "",
      lib: "",
      name: "Choice",
      cases: [
        xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
          new xdr.ScSpecUdtUnionCaseVoidV0({ doc: "", name: "None" }),
        ),
      ],
    }),
  );

  it("lists only function entries, ignoring struct, enum, error-enum and union entries", async () => {
    const spec = new contract.Spec([
      structEntry,
      functionEntry("first", []),
      enumEntry,
      errorEnumEntry,
      unionEntry,
      functionEntry("second", []),
    ]);

    const functions = await decode(spec);

    expect(functions.map((f) => f.name)).toEqual(["first", "second"]);
  });

  it("returns an empty list for a spec with no functions", async () => {
    expect(await decode(new contract.Spec([structEntry, enumEntry]))).toEqual(
      [],
    );
  });

  it("preserves spec order, output counts and docs", async () => {
    const spec = new contract.Spec([
      functionEntry(
        "b_last_declared_first",
        [],
        [T.scSpecTypeU32()],
        "first doc",
      ),
      functionEntry("a_declared_second", [], [], ""),
      functionEntry("multi", [], [T.scSpecTypeU32(), T.scSpecTypeBool()]),
    ]);

    const functions = await decode(spec);

    expect(functions.map((f) => f.name)).toEqual([
      "b_last_declared_first",
      "a_declared_second",
      "multi",
    ]);
    expect(functions.map((f) => f.outputsCount)).toEqual([1, 0, 2]);
    expect(functions[0].doc).toBe("first doc");
  });

  it("keeps argument names and order", async () => {
    const spec = new contract.Spec([
      functionEntry("transfer", [
        { name: "from", type: T.scSpecTypeAddress() },
        { name: "to", type: T.scSpecTypeAddress() },
        { name: "amount", type: T.scSpecTypeI128() },
      ]),
    ]);

    const functions = await decode(spec);

    expect(functions[0].args.map((a) => a.name)).toEqual([
      "from",
      "to",
      "amount",
    ]);
  });
});

// The labels produced above are what ContractCallForm feeds to its validator
// (`<arg>.type` is passed to `validateArgValue`), so decode -> validate must
// agree for every type.
describe("round trip with ContractCallForm validation", () => {
  const G = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
  const M = `M${"A".repeat(68)}`;

  // [label, a value the form must accept, a value it must reject (or null if only emptiness is checked)]
  const checks: Array<[string, string, string | null]> = [
    ["bool", "true", "yes"],
    ["u32", "4294967295", "4294967296"],
    ["i32", "-2147483648", "-2147483649"],
    ["u64", "18446744073709551615", "18446744073709551616"],
    ["i64", "-9223372036854775808", "9223372036854775808"],
    ["Timepoint", "0", "-1"],
    ["Duration", "0", "1.5"],
    [
      "u128",
      "340282366920938463463374607431768211455",
      "340282366920938463463374607431768211456",
    ],
    [
      "i128",
      "-170141183460469231731687303715884105728",
      "170141183460469231731687303715884105728",
    ],
    ["u256", "1", "-1"],
    ["i256", "-1", "abc"],
    ["Address", G, "GABC"],
    ["MuxedAddress", M, "MABC"],
    ["Symbol", "transfer_1", "has space"],
    ["Bytes", "00ff", null],
    ["String", "hello", null],
    ["Vec", "[1,2]", null],
    ["Map", "{}", null],
    ["Option", "1", null],
    ["Tuple", "[1,true]", null],
    ["BytesN", "00", null],
    ["Result", "1", null],
    ["Udt", "{}", null],
  ];

  it.each(checks)(
    "%s: accepts a valid value and rejects an invalid one",
    (label, valid, invalid) => {
      expect(validateArgValue(valid, label)).toBeNull();
      if (invalid !== null) {
        expect(validateArgValue(invalid, label)).not.toBeNull();
      }
    },
  );

  it.each(checks.map(([label]) => [label]))(
    "%s: an empty value is always rejected as required",
    (label) => {
      expect(validateArgValue("", label)).toBe("This argument is required.");
      expect(validateArgValue("   ", label)).toBe("This argument is required.");
    },
  );

  it("accepts any non-empty value for a type tag the form does not know", async () => {
    const functions = await decode(
      fakeSpecWithTypeTags(["scSpecTypeFutureThing"]),
    );
    const unknownType = functions[0].args[0].type;

    expect(validateArgValue("anything", unknownType)).toBeNull();
    expect(validateArgValue("", unknownType)).not.toBeNull();
  });

  it("every label a real decode produces is accepted by the form for a sample value", async () => {
    const spec = new contract.Spec(
      TYPE_TABLE.filter(([label]) => label !== "void").map(
        ([label, makeType]) =>
          functionEntry(`fn_${label.toLowerCase()}`, [
            { name: "x", type: makeType() },
          ]),
      ),
    );
    const functions = await decode(spec);
    const samples = new Map(checks.map(([label, valid]) => [label, valid]));

    for (const fn of functions) {
      const { type } = fn.args[0];
      // `void` has no value; every other decoded label must have a sample the form accepts.
      expect(samples.has(type)).toBe(true);
      expect(validateArgValue(samples.get(type) as string, type)).toBeNull();
    }
  });
});
