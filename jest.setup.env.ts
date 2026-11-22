/**
 * Runs before each test file's modules load. CI runners export `CI` and
 * `GITHUB_ACTIONS`, which flip environment-sensitive behaviour the suites
 * assert on (picocolors enables ANSI colour, the update notifier and
 * spinners switch off). Clear them so results match a local run; tests that
 * exercise CI behaviour set these variables explicitly. Child processes the
 * tests spawn (e.g. the CLI via execa) inherit this cleaned environment.
 */
for (const name of ["CI", "GITHUB_ACTIONS", "FORCE_COLOR"]) {
  delete process.env[name];
}
