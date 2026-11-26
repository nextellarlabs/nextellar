/**
 * @jest-environment jsdom
 *
 * useStellarWallet — full template overlay (#1203)
 */
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useStellarWallet (full template, #1203)", () => {
  expectFullHookPort("useStellarWallet");
});
