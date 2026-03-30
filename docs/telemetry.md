# Nextellar Telemetry

Nextellar telemetry is anonymous, minimal, and opt-in.

## Consent Model

- Telemetry is disabled by default until explicitly enabled.
- On first run, Nextellar shows a transparency notice:
  - `Nextellar collects anonymous usage data to improve the tool.`
  - `You can disable this with --no-telemetry or NEXTELLAR_TELEMETRY_DISABLED=1`
  - `Learn more: https://nextellar.dev/telemetry`
- Users can manage preferences with:
  - `nextellar telemetry status`
  - `nextellar telemetry enable`
  - `nextellar telemetry disable`

Preferences are stored in `~/.nextellar/config.json`.

## Disable Controls

- Per invocation: `--no-telemetry`
- Environment override: `NEXTELLAR_TELEMETRY_DISABLED=1`
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

## Reliability and Performance

- Telemetry is non-blocking and fire-and-forget.
- Request timeout is 3 seconds.
- Failures are silent and never block scaffolding.
- Offline execution is supported (no errors surfaced to users).
