# Nextellar Telemetry

Nextellar telemetry is anonymous, minimal, and opt-in.

## Consent Model

- Telemetry is disabled by default until explicitly enabled.
- On first run, Nextellar shows a transparency notice:
  - `Nextellar collects anonymous usage data (CLI version, OS, template selection, package manager) to improve the tool.`
  - `You can disable telemetry at any time using nextellar telemetry disable, --no-telemetry, or NEXTELLAR_TELEMETRY_DISABLED=1`
  - `Learn more: docs/telemetry.md or https://nextellar.dev/telemetry`
- Users can manage preferences with:
  - `nextellar telemetry status`
  - `nextellar telemetry enable`
  - `nextellar telemetry disable`

Preferences are stored in `~/.nextellar/config.json`.

## Disable Controls

- Per invocation: `--no-telemetry`
- Environment override: `NEXTELLAR_TELEMETRY_DISABLED=1|true|yes|on` (case-insensitive)
- Persistent opt-out: `nextellar telemetry disable`

## Data Collected

Only this payload is sent for scaffold events:

```json
{
  "event": "scaffold",
  "anonymousId": "random-uuid",
  "properties": {
    "template": "default",
    "language": "typescript",
    "network": "testnet",
    "wallets": ["freighter", "albedo"],
    "packageManager": "npm",
    "withContracts": false,
    "skipInstall": false,
    "success": true,
    "cliVersion": "1.0.4",
    "nodeVersion": "20.10.0",
    "os": "darwin"
  }
}
```

Not collected:

- project name
- file paths
- environment variables
- API keys
- user identity

## Data Retention and Deletion

- Telemetry events are retained for 90 days from the time they are received, then permanently deleted.
- Data is stored solely to compute aggregate usage trends (e.g. template popularity, package manager share); it is never sold or shared with third parties.
- Because events carry only a random `anonymousId` and no user identity, individual deletion requests cannot be matched to a specific person. To stop all future collection, disable telemetry with `nextellar telemetry disable`, `--no-telemetry`, or `NEXTELLAR_TELEMETRY_DISABLED=1`.
- Anyone with residual concerns about previously submitted data can contact the maintainers at the address listed on https://nextellar.dev/telemetry to request early deletion of events tied to a specific `anonymousId`.

## Reliability and Performance

- Telemetry is non-blocking and fire-and-forget.
- Request timeout is 3 seconds.
- Failures are silent and never block scaffolding.
- Offline execution is supported (no errors surfaced to users).
