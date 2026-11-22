# SEP-30 Recovery Troubleshooting Guide

This guide maps common `useSep30Recovery` / `lib/sep30.ts` failures to their
underlying causes and recommended fixes. SEP-30 recovery requests
(`register`, `recover`, and discovery) all surface failures the same way: as
a thrown `Error`, visible via `useSep30Recovery()`'s `error` field, or
rejected from the hook's `discover`/`register`/`recover` functions directly.

---

## 1. Discovery fails: stellar.toml is missing `RECOVERY_SIGNER`

### Error Message
```text
discoverSep30RecoveryServer: "<domain>" stellar.toml is missing RECOVERY_SIGNER.
```

### Cause
The anchor/issuer's `stellar.toml` either doesn't publish a `RECOVERY_SIGNER`
entry at all, or the `homeDomain` passed to `discover()`/the hook's
`homeDomain` option is wrong (a typo, or the domain for a different anchor
entirely).

### Fix / Resolution
1. Fetch the domain's `stellar.toml` directly
   (`https://<domain>/.well-known/stellar.toml`) and confirm `RECOVERY_SIGNER`
   is present under `[[CURRENCIES]]` or the top-level config, per the anchor's
   documentation.
2. Double-check the domain you're passing — this is the anchor's advertised
   home domain, not the recovery server's own hostname.
3. If the anchor genuinely doesn't support SEP-30, skip discovery and call
   `register`/`recover` with an explicit `serverUrl` instead (see `useSep30Recovery`'s
   `UseSep30RecoveryOptions.serverUrl`), if you already know the server URL
   out of band.

---

## 2. `register`/`recover` rejects before any network call: missing serverUrl or homeDomain

### Error Message
```text
register: serverUrl or hook homeDomain is required
recover: serverUrl or hook homeDomain is required
```

### Cause
Neither an explicit `serverUrl` (passed to the call, or set as the hook's
`UseSep30RecoveryOptions.serverUrl`) nor a `homeDomain` (for discovery) was
provided. The hook has nothing to resolve a server URL from and refuses
rather than silently doing nothing.

### Fix / Resolution
- Pass `serverUrl` directly if you already resolved it (e.g. via a prior
  `discover()` call, or because you know the anchor's recovery server URL).
- Otherwise construct the hook with `{ homeDomain: '<anchor-domain>' }` so it
  can discover the server URL automatically on each call.

---

## 3. Recovery server returns 401 Unauthorized

### Error Message
```text
SEP-30 request failed (401): <server-provided detail>
```

### Cause
The `authToken` (a SEP-10 JWT) passed to `register()` is missing, expired, or
was issued for a different account than `accountId`. SEP-30's `register`
endpoint requires SEP-10 authentication scoped to the account being
registered; `recover()` intentionally does not send an `authToken` — see
§5 below if a 401 shows up there instead.

### Fix / Resolution
1. Confirm the SEP-10 challenge was signed by (and the resulting JWT's
   subject matches) the same `accountId` you're registering.
2. Re-run the SEP-10 auth flow if the JWT has expired — most anchors issue
   short-lived tokens (often 24 hours or less).

---

## 4. Recovery server returns 404: account not registered

### Error Message
```text
SEP-30 request failed (404): <server-provided detail>
```

### Cause
`recover()` was called for an `accountId` that was never registered with
this recovery server (or was registered with a different one). SEP-30
recovery servers only have recovery material for accounts that completed
`register()` against them first.

### Fix / Resolution
1. Confirm `register()` previously succeeded for this exact `accountId` and
   `serverUrl` — registration and recovery must target the same server.
2. If the account should be recoverable but isn't, re-register it (idempotent
   per SEP-30 — `registerSep30Account` updates the signer set if already
   registered).

---

## 5. Recovery server returns 409: signature threshold / signer mismatch

### Error Message
```text
SEP-30 request failed (409): <server-provided detail>
```

### Cause
The `recoveryToken` (challenge/share material) presented to `recover()`
doesn't satisfy the recovery server's own verification requirement for this
account — commonly because the account's on-chain signer configuration
changed since registration (a signer was added/removed, or thresholds
changed), so the server's authorization policy for recovering this account
no longer matches what it was told to expect at `register()` time.

### Fix / Resolution
1. Re-register the account (`register()` again with the current signer set)
   if its on-chain signers or thresholds have changed since the last
   successful registration.
2. Check the server-provided `detail` in the error message — most anchors
   include a specific reason (e.g. "signature threshold not met",
   "unexpected signer") that narrows this down further; it's surfaced
   verbatim in the thrown error.
3. If the anchor requires a specific recovery flow (e.g. a secondary auth
   step) before issuing a valid `recoveryToken`, confirm that flow completed
   successfully first — an expired or already-used token also surfaces as a
   409 or 400 from most implementations.
