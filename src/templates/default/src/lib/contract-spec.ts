import { contract, rpc } from '@stellar/stellar-sdk';

/**
 * Contract spec/ABI fetch helper.
 *
 * Fetches a deployed Soroban contract's WASM bytecode from the RPC (via
 * `getContractData`/`getLedgerEntries` under the hood) and decodes its
 * `contractspecv0` custom section into a `contract.Spec` — the same shape
 * the Stellar SDK's generated contract clients use internally. Exposes a
 * flattened, JSON-friendly function list so UI code (e.g. `ContractCallForm`)
 * can build a function picker without dealing with raw XDR types.
 */

/** A single named argument for a contract function, with its type rendered as a readable label. */
export interface ContractFunctionArg {
  /** Argument name, as declared in the contract's `#[contractimpl]` signature. */
  name: string;
  /** Human-readable type label (e.g. `"u128"`, `"Address"`, `"Vec<u32>"`). Best-effort — falls back to the raw XDR type tag for types not covered by the label heuristic below. */
  type: string;
}

/** A single contract function, decoded from the spec for display/selection purposes. */
export interface ContractFunctionSpec {
  /** Function name, as declared in the contract. */
  name: string;
  /** Ordered list of the function's arguments. */
  args: ContractFunctionArg[];
  /** Number of return values (0 for void-returning functions, otherwise usually 1). */
  outputsCount: number;
  /** Doc comment attached to the function, if any. */
  doc: string;
}

/**
 * Result of `fetchContractSpec`: the decoded functions plus the underlying
 * `contract.Spec` for callers that need lower-level access (e.g.
 * `spec.funcArgsToScVals` / `spec.jsonSchema`).
 */
export interface ContractSpecResult {
  /** All functions declared in the contract, in spec order. */
  functions: ContractFunctionSpec[];
  /** The raw `contract.Spec` instance, for advanced use (arg encoding, JSON schema, etc). */
  spec: contract.Spec;
}

/**
 * Best-effort human-readable label for an `xdr.ScSpecTypeDef`.
 *
 * Covers the primitive and common container types. Falls back to the XDR
 * type tag name (e.g. `"scSpecTypeUdt"`) for user-defined types, since
 * resolving those to their declared name requires cross-referencing the
 * spec's UDT entries — out of scope for the flattened summary this helper
 * returns (use `spec.findEntry` / the raw `xdr.ScSpecTypeDef` for that).
 */
function describeType(type: unknown): string {
  const t = type as { switch: () => { name: string } };
  const tagName = t.switch().name;

  const labels: Record<string, string> = {
    scSpecTypeVal: 'Val',
    scSpecTypeBool: 'bool',
    scSpecTypeVoid: 'void',
    scSpecTypeError: 'Error',
    scSpecTypeU32: 'u32',
    scSpecTypeI32: 'i32',
    scSpecTypeU64: 'u64',
    scSpecTypeI64: 'i64',
    scSpecTypeTimepoint: 'Timepoint',
    scSpecTypeDuration: 'Duration',
    scSpecTypeU128: 'u128',
    scSpecTypeI128: 'i128',
    scSpecTypeU256: 'u256',
    scSpecTypeI256: 'i256',
    scSpecTypeBytes: 'Bytes',
    scSpecTypeString: 'String',
    scSpecTypeSymbol: 'Symbol',
    scSpecTypeAddress: 'Address',
    scSpecTypeMuxedAddress: 'MuxedAddress',
    scSpecTypeOption: 'Option',
    scSpecTypeResult: 'Result',
    scSpecTypeVec: 'Vec',
    scSpecTypeMap: 'Map',
    scSpecTypeTuple: 'Tuple',
    scSpecTypeBytesN: 'BytesN',
    scSpecTypeUdt: 'Udt',
  };

  return labels[tagName] ?? tagName;
}

/**
 * Fetches a deployed contract's on-chain spec/ABI and decodes it into a
 * flattened list of callable functions.
 *
 * @param server - Soroban RPC client (or a URL string, for convenience).
 * @param contractId - StrKey-encoded contract address (`C...`).
 * @param networkPassphrase - Network the contract is deployed on. Only used
 *   to satisfy `ClientOptions`'s shape — spec decoding itself is
 *   network-agnostic, but the SDK's `Client` type requires it.
 * @returns The decoded function list plus the underlying `contract.Spec`.
 * @throws If the contract has no WASM (e.g. it's a stub / not yet deployed)
 *   or its WASM has no embedded `contractspecv0` section.
 *
 * @example
 * ```ts
 * const { functions } = await fetchContractSpec(rpcServer, contractId, Networks.TESTNET);
 * const transferFn = functions.find((f) => f.name === 'transfer');
 * console.log(transferFn?.args.map((a) => `${a.name}: ${a.type}`));
 * ```
 */
export async function fetchContractSpec(
  server: rpc.Server | string,
  contractId: string,
  networkPassphrase: string,
): Promise<ContractSpecResult> {
  const rpcServer = typeof server === 'string' ? new rpc.Server(server) : server;
  const wasm = await rpcServer.getContractWasmByContractId(contractId);

  const client = await contract.Client.fromWasm(wasm, {
    contractId,
    networkPassphrase,
    rpcUrl: rpcServer.serverURL.toString(),
  });

  const functions: ContractFunctionSpec[] = client.spec.funcs().map((fn) => ({
    name: fn.name().toString(),
    args: fn.inputs().map((input) => ({
      name: input.name().toString(),
      type: describeType(input.type()),
    })),
    outputsCount: fn.outputs().length,
    doc: fn.doc().toString(),
  }));

  return { functions, spec: client.spec };
}
