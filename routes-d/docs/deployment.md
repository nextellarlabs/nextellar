# routes-d deployment runbook

## Environment variables

- `NODE_ENV`: `production` for deployed services.
- `PORT`: HTTP listener port assigned by the platform.
- `ROUTES_D_CURSOR_SECRET`: at least 16 characters, shared by all instances in the same environment.
- `ROUTES_D_PROFILE_USERS` and `ROUTES_D_PROFILE_REFRESHES`: optional local profiling controls; do not set these for normal request serving.

## Secrets

Store secrets in the platform secret manager rather than checked-in files. Rotate `ROUTES_D_CURSOR_SECRET` during a maintenance window because existing cursors signed by the old key will be rejected after rotation.

## External dependencies

Routes under `routes-d/` depend on the Node.js runtime, Express middleware wiring from the host app, Stellar RPC or Horizon providers for live ledger and pool operations, and the deployment platform's log and metrics sinks. Verify provider credentials and network allowlists before promoting a release.

## Canary rollout

1. Deploy the build to a single canary instance or the smallest traffic slice the platform supports.
2. Run smoke checks for `/stellar/ledger/stream`, pool deposit and withdraw envelope creation, cursor decoding, and auth refresh traffic.
3. Watch p95 latency, error rate, startup duration, and SSE disconnects for at least one full observation window.
4. Increase traffic gradually to 25%, 50%, and 100% when metrics remain within the service objectives.

## Rollback

Rollback to the previous image or deployment revision if error rate, startup duration, auth refresh latency, or ledger stream disconnects regress beyond the release threshold. After rollback, confirm traffic is fully back on the previous revision and invalidate any canary-only config values that were introduced for the failed rollout.

## On-call escalation

Page the primary backend on-call for authentication, pagination, or route bootstrap failures. Escalate Stellar provider incidents to the infrastructure on-call when ledger stream failures correlate with provider errors, rate limits, or network reachability. Include deployment revision, environment, first failing timestamp, and a sample request or trace ID in the incident handoff.
