/**
 * @jest-environment jsdom
 *
 * useTransactionHistory — full template overlay (#1203)
 */
import { expectFullHookPort } from "../helpers/full-hook-parity";

describe("useTransactionHistory (full template, #1203)", () => {
  expectFullHookPort("useTransactionHistory");
});
