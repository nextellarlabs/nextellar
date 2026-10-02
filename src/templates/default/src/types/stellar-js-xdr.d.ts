/**
 * `@stellar/js-xdr` ships no type declarations. It's already a transitive
 * dependency of `@stellar/stellar-sdk` (via `@stellar/stellar-base`) and is
 * declared directly in this template's `package.json` to pin the version
 * these types describe. Only the two primitives actually used in this
 * project are declared: `XdrReader`/`XdrWriter`, the low-level cursor
 * objects that generated `xdr.*` types' `read`/`write` static methods
 * require — needed to compose/decode a `SorobanAuthorizationEntry[]` XDR
 * array in `src/lib/sep45.ts`, since not every installed
 * `@stellar/stellar-sdk` version exposes a ready-made
 * `xdr.SorobanAuthorizationEntries` array codec.
 */
declare module '@stellar/js-xdr' {
  export class XdrWriter {
    constructor();
    finalize(): Buffer;
  }
  export class XdrReader {
    constructor(input: Buffer);
    readonly eof: boolean;
  }
  const _default: { XdrReader: typeof XdrReader; XdrWriter: typeof XdrWriter };
  export default _default;
}
