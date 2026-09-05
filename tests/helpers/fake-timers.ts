/**
 * Deterministic fake-timer helpers for testing polling/backoff hooks.
 *
 * `useOfferBook` and `useSorobanEvents` (see the `hooks` directory under
 * each entry in `src/templates`) both poll on an interval and, in the
 * events hook's case, retry with
 * exponential backoff. Testing that behavior with real timers is slow and
 * flaky; testing it with `jest.useFakeTimers()` directly works but every
 * test file ends up re-implementing the same "advance timers, then flush
 * the microtask queue so React state updates land" dance.
 *
 * This module centralizes that dance so hook tests stay focused on
 * assertions instead of timer plumbing. It intentionally wraps `jest`'s
 * fake timer APIs rather than replacing them — call `useFakeHookTimers()` /
 * `useRealHookTimers()` in `beforeEach` / `afterEach` (or use
 * `withFakeHookTimers`), then use `flush`, `advanceAndFlush`, and
 * `exhaustPendingTimers` inside `act()`-wrapped assertions.
 */
import { act } from "@testing-library/react";
import { jest } from "@jest/globals";

/**
 * Switches Jest to modern fake timers. Call from `beforeEach` before
 * rendering any hook that schedules `setTimeout`/`setInterval`.
 */
export function useFakeHookTimers(): void {
  jest.useFakeTimers();
}

/**
 * Restores real timers. Call from `afterEach` to avoid leaking fake timers
 * into unrelated tests.
 */
export function useRealHookTimers(): void {
  jest.useRealTimers();
}

/**
 * Registers `beforeEach`/`afterEach` hooks that switch to fake timers for
 * the duration of the current `describe` block and restore real timers
 * afterward. Use this when a whole suite polls on a timer, instead of
 * calling `useFakeHookTimers`/`useRealHookTimers` manually in every file.
 *
 * @example
 * describe('useOfferBook polling', () => {
 *   withFakeHookTimers();
 *   it('polls on the configured interval', async () => { ... });
 * });
 */
export function withFakeHookTimers(): void {
  beforeEach(() => {
    useFakeHookTimers();
  });

  afterEach(() => {
    useRealHookTimers();
  });
}

/**
 * Flushes pending microtasks (promise resolutions, effect callbacks) so
 * that async state updates triggered by a hook are applied before the next
 * assertion. Wrap this around a bare `renderHook()` call to let the
 * initial fetch/effect settle.
 */
export async function flush(): Promise<void> {
  await act(async () => {});
}

/**
 * Advances fake timers by `ms` and flushes the resulting microtasks. This
 * is the standard way to simulate "one poll interval has elapsed" for a
 * hook under test.
 *
 * @param ms - Milliseconds to advance the fake clock by.
 */
export async function advanceAndFlush(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

/**
 * Repeatedly fires all pending timers and flushes microtasks, to exhaust a
 * chain of retry/backoff timeouts whose exact delays aren't worth
 * hardcoding in the test (e.g. `useSorobanEvents`' exponential backoff).
 *
 * @param iterations - Max number of fire/flush cycles to run. Defaults to
 *   10, which comfortably exceeds the retry counts used by hooks in this
 *   repo; increase it only if a hook legitimately needs more polling
 *   cycles to reach a terminal state.
 */
export async function exhaustPendingTimers(iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
  }
}
