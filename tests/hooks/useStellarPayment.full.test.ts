/**
 * @jest-environment jsdom
 *
 * useStellarPayment — full template overlay (#1203)
 */
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useStellarPayment (full template, #1203)", () => {
  expectFullHookPort("useStellarPayment");
});
