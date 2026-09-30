import { xdr } from "@stellar/stellar-sdk";
import {
  decodeSorobanEvent,
  decodeSorobanValue,
} from "../../src/templates/default/src/lib/soroban-event-decoder";

describe("Soroban event decoding helpers", () => {
  it("decodes typed topics and event data from sample XDR", () => {
    const event = {
      topic: [
        xdr.ScVal.scvSymbol("transfer").toXDR("base64"),
        xdr.ScVal.scvU32(7).toXDR("base64"),
      ],
      value: xdr.ScVal.scvString("hello").toXDR("base64"),
    };
    expect(decodeSorobanEvent(event)).toEqual({
      topics: ["transfer", 7],
      value: "hello",
    });
  });

  it("supports booleans and big integer values", () => {
    expect(decodeSorobanValue(xdr.ScVal.scvBool(true).toXDR("base64"))).toBe(
      true,
    );
    expect(
      decodeSorobanValue(
        xdr.ScVal.scvU64(xdr.Uint64.fromString("9007199254740993")).toXDR(
          "base64",
        ),
      ),
    ).toBe(9007199254740993n);
  });
});
