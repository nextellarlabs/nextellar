# Changelog

All notable changes to Nextellar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Pull requests that change files under `src/templates/` must add an entry under
**Unreleased** (or carry the `skip-changelog` label). See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog-entries-for-template-changes).

## [Unreleased]

### Added

- `useSep10Auth` hook in the default template (feature `sep10-auth`): fetches
  the SEP-10 challenge from the anchor's `WEB_AUTH_ENDPOINT`, verifies it
  before signing, signs it with the connected wallet and returns the JWT,
  cached until it expires, with `logout`. The protocol steps are exported from
  `lib/sep10.ts`. (#1448)
- SEP-7 helpers in the default template now throw a typed `Sep7Error` with a
  stable `code` (`INVALID_INPUT`, `INVALID_URI`, `UNSUPPORTED_OPERATION`,
  `MISSING_DESTINATION`, `INVALID_ASSET`, `INVALID_MEMO_TYPE`, `MSG_TOO_LONG`)
  instead of a plain `Error`. It is still an `Error` and the messages are
  unchanged, so existing `catch` blocks keep working. (#1512)
- CI check that fails pull requests changing `src/templates/**` without a
  changelog entry, with a `skip-changelog` opt-out label. (#1519)

### Fixed

- The default template's `package.json` was invalid JSON (a duplicated
  `lucide-react` entry missing its comma), which broke installs of scaffolded
  apps and module resolution for the default-template hook tests. (#1448)
