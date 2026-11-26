/**
 * @jest-environment jsdom
 *
 * useStellarBalances — full template overlay (#1203)
 */
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useStellarBalances (full template, #1203)", () => {
  expectFullHookPort("useStellarBalances");
});
