import { jest } from "@jest/globals";
import { act } from "@testing-library/react";

type ConsoleMethod = "error" | "warn" | "log" | "info";

/**
 * Silence `console.*` for a test (ErrorBoundary / hook noise) and return a
 * restore function to call from `afterEach`.
 */
export function silenceConsole(
  methods: ConsoleMethod[] = ["error"],
): () => void {
  const spies = methods.map((method) =>
    jest.spyOn(console, method).mockImplementation(() => {}),
  );
  return () => {
    for (const spy of spies) spy.mockRestore();
  };
}

/** Flush microtasks so async hook state updates are applied. */
export async function flush(): Promise<void> {
  await act(async () => {});
}
