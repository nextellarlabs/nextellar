/**
 * Horizon-facing mock factory for `@stellar/stellar-sdk`, used by the template
 * hook tests that exercise trustlines and payments.
 *
 * Unlike `stellar-sdk-mock.ts` — which replaces the whole module surface with
 * `jest.fn()`s — this mock keeps the *real* SDK for everything that is pure
 * local computation (`Keypair`, `Asset`, `Operation`, `TransactionBuilder`,
 * `Transaction`, `Memo`, `Networks`, `BASE_FEE`) and stubs only `Horizon.Server`,
 * the network boundary.
 *
 * That split matters: the hooks under test build and sign genuine transactions,
 * so an XDR a test asserts on is one the real SDK produced and can parse back.
 * A fully-stubbed SDK would accept a malformed operation and still pass.
 *
 * Usage — the factory must be invoked through `jest.requireActual`, otherwise
 * the mock's own `import '@stellar/stellar-sdk'` resolves back to the mock and
 * the worker hangs on the cycle:
 *
 * ```ts
 * await jest.unstable_mockModule('@stellar/stellar-sdk', async () => {
 *   const actual = await jest.requireActual('@stellar/stellar-sdk');
 *   const { createHorizonMock } = await import('../../src/mocks/stellar-horizon-mock.js');
 *   return createHorizonMock(actual);
 * });
 * ```
 *
 * Call `resetHorizonMocks()` in `beforeEach` so queued resolutions and
 * rejections don't leak between cases.
 */

import { jest } from '@jest/globals';

// ── Network boundary (stubbed) ──────────────────────────────────────────────

// The mocks stand in for Horizon responses, whose shapes vary per endpoint and
// are only partially constructed by tests. They are typed loosely on purpose:
// a bare `jest.fn()` from '@jest/globals' infers its parameters as `never`, so
// every `mockResolvedValue(...)` in a test would be a type error.
type AnyAsyncMock = jest.Mock<(...args: never[]) => Promise<unknown>>;

/** Resolves/rejects `accounts().accountId(id).call()` — used by refresh(). */
export const mockAccountCall = jest.fn() as AnyAsyncMock;

/** Resolves/rejects `loadAccount()` — used when building a transaction. */
export const mockLoadAccount = jest.fn() as AnyAsyncMock;

/** Resolves/rejects `submitTransaction()`. */
export const mockSubmitTransaction = jest.fn() as AnyAsyncMock;

/** Captures the URL each `new Horizon.Server(...)` was constructed with. */
export const mockHorizonServerConstructor = jest.fn() as jest.Mock<
  (...args: never[]) => unknown
>;

const makeServer = () => ({
  accounts: jest.fn(() => ({
    accountId: jest.fn(() => ({ call: mockAccountCall })),
  })),
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
});

mockHorizonServerConstructor.mockImplementation(makeServer);

/**
 * Reset every network-boundary mock, restoring the default `Horizon.Server`
 * implementation. Call from `beforeEach`.
 */
export function resetHorizonMocks(): void {
  mockAccountCall.mockReset();
  mockLoadAccount.mockReset();
  mockSubmitTransaction.mockReset();
  mockHorizonServerConstructor.mockReset();
  mockHorizonServerConstructor.mockImplementation(makeServer);
}

/**
 * Build the mocked module surface from the real SDK.
 *
 * @param actual - The genuine `@stellar/stellar-sdk` namespace, obtained via
 *   `jest.requireActual`. Passing it in (rather than importing it here) is what
 *   keeps the mock from resolving to itself.
 */
export function createHorizonMock(actual: Record<string, unknown>) {
  return {
    ...actual,
    Horizon: {
      ...(actual.Horizon as Record<string, unknown>),
      Server: mockHorizonServerConstructor,
    },
  };
}
