# Changelog

All notable changes to Nextellar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Pull requests that change files under `src/templates/` must add an entry under
**Unreleased** (or carry the `skip-changelog` label). See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog-entries-for-template-changes).

## [Unreleased]

### Added

- SEP-7 helpers in the default template now throw a typed `Sep7Error` with a
  stable `code` (`INVALID_INPUT`, `INVALID_URI`, `UNSUPPORTED_OPERATION`,
  `MISSING_DESTINATION`, `INVALID_ASSET`, `INVALID_MEMO_TYPE`, `MSG_TOO_LONG`)
  instead of a plain `Error`. It is still an `Error` and the messages are
  unchanged, so existing `catch` blocks keep working. (#1512)
- CI check that fails pull requests changing `src/templates/**` without a
  changelog entry, with a `skip-changelog` opt-out label. (#1519)
- `nextellar upgrade --interactive` (`-i`) reviews each drifted template file
  individually with a diff preview and an `apply` / `skip` / `quit` prompt.
  Skip decisions are persisted in `.nextellar/upgrade-state.json` keyed by the
  incoming template's SHA-256, so unchanged templates are auto-skipped on later
  runs and a changed template is prompted again. (#1487)

### Fixed

- Repaired a malformed `src/templates/default/package.json` (missing comma and
  duplicate `lucide-react` key) that made the default template's package
  metadata unreadable.
