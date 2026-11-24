/**
 * @jest-environment jsdom
 *
 * useTrustlines — full template overlay (#1203)
 */
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useTrustlines (full template, #1203)", () => {
  expectFullHookPort("useTrustlines");
});
