# Changelog

All notable changes to Nextellar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Pull requests that change files under `src/templates/` must add an entry under
**Unreleased** (or carry the `skip-changelog` label). See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog-entries-for-template-changes).

## [Unreleased]

### Added

- Default template: a same-origin `/api/horizon/[...path]` proxy forwards an
  allowlisted set of read-only Horizon paths with the provider API key injected
  server-side, short-lived GET caching, and rate-limit header passthrough.
  Client hooks opt in with `NEXT_PUBLIC_HORIZON_PROXY=true`, keeping hosted
  Horizon keys out of `NEXT_PUBLIC_*` variables. See `docs/horizon-proxy.md`.
  (#1461)
- SEP-7 helpers in the default template now throw a typed `Sep7Error` with a
  stable `code` (`INVALID_INPUT`, `INVALID_URI`, `UNSUPPORTED_OPERATION`,
  `MISSING_DESTINATION`, `INVALID_ASSET`, `INVALID_MEMO_TYPE`, `MSG_TOO_LONG`)
  instead of a plain `Error`. It is still an `Error` and the messages are
  unchanged, so existing `catch` blocks keep working. (#1512)
- CI check that fails pull requests changing `src/templates/**` without a
  changelog entry, with a `skip-changelog` opt-out label. (#1519)
