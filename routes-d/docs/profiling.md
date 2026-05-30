# Authentication hot-path profiling

The harness in `routes-d/tests/bench/auth-hot-path-profile.ts` drives simulated login and refresh work under controlled load and writes a V8 CPU profile to `routes-d/tests/artifacts/auth-hot-path.cpuprofile`.

## Run

```bash
ROUTES_D_PROFILE_USERS=50 ROUTES_D_PROFILE_REFRESHES=5 node --loader ts-node/esm routes-d/tests/bench/auth-hot-path-profile.ts
```

Use `ROUTES_D_PROFILE_OUTPUT` to override the artifact path for CI jobs or local comparisons.

## Workflow

1. Run the harness on the target branch and save the generated `.cpuprofile`.
2. Run it again on the comparison branch with the same user and refresh counts.
3. Open both profiles in Chrome DevTools Performance or another V8 profile viewer.
4. Compare login and refresh self time, total time, and allocation-heavy frames before changing the auth path.

The test suite runs the harness with a tiny load to guard against broken imports, missing artifact directories, and profile serialization failures.
