import pc from "picocolors";

/**
 * Process-wide verbose flag, set once at CLI startup from the --verbose
 * flag shared across scaffold, add, upgrade and deploy. A module-level flag
 * (rather than threading a boolean through every function signature) keeps
 * every command's existing catch block able to opt into extra diagnostic
 * output with a single call, without a signature change cascading through
 * every layer that might fail.
 */
let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

/**
 * Prints extra diagnostic output for a caught error, only when --verbose is
 * set. Intended for a command's top-level catch block, after it has already
 * printed its normal, short user-facing error message.
 */
export function logVerboseError(err: unknown): void {
  if (!verboseEnabled) return;

  console.error(pc.dim("\n[verbose] diagnostic details:"));
  if (err instanceof Error) {
    console.error(pc.dim(err.stack || err.message));
  } else {
    console.error(pc.dim(String(err)));
  }

  const anyErr = err as { stderr?: unknown; stdout?: unknown; exitCode?: unknown } | null;
  if (anyErr && typeof anyErr === "object") {
    if (typeof anyErr.exitCode !== "undefined") {
      console.error(pc.dim(`[verbose] exit code: ${anyErr.exitCode}`));
    }
    if (typeof anyErr.stdout === "string" && anyErr.stdout.trim().length > 0) {
      console.error(pc.dim(`[verbose] stdout:\n${anyErr.stdout.trim()}`));
    }
    if (typeof anyErr.stderr === "string" && anyErr.stderr.trim().length > 0) {
      console.error(pc.dim(`[verbose] stderr:\n${anyErr.stderr.trim()}`));
    }
  }
}
