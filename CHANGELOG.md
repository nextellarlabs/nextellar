# Changelog

All notable changes to Nextellar are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Pull requests that change files under `src/templates/` must add an entry under
**Unreleased** (or carry the `skip-changelog` label). See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog-entries-for-template-changes).

## [Unreleased]

### Added

- `full` template now ships the wallet and account components
  (`WalletConnectButton`, `AccountSwitcher`, `NetworkSwitcher`,
  `NetworkMismatchBanner`), the UI utilities (`CopyButton`, `EmptyState`,
  `ErrorBoundary`, `LoadingBoundary`, `Skeleton`/`SkeletonList`,
  `ThemeToggle`) and the Soroban hooks (`useSorobanEvents`,
  `useContractDeploy`, `useContractUpgrade`, `useContractEventHistory`), with
  a parity test that keeps them identical to `default`. (#1199, #1201, #1204)
- Scaffold matrix job that scaffolds into a directory path longer than 260
  characters on `windows-latest` and checks placeholder replacement and
  `.gitignore` handling with `scripts/verify-scaffold-output.mjs`. (#1492)
- SEP-7 helpers in the default template now throw a typed `Sep7Error` with a
  stable `code` (`INVALID_INPUT`, `INVALID_URI`, `UNSUPPORTED_OPERATION`,
  `MISSING_DESTINATION`, `INVALID_ASSET`, `INVALID_MEMO_TYPE`, `MSG_TOO_LONG`)
  instead of a plain `Error`. It is still an `Error` and the messages are
  unchanged, so existing `catch` blocks keep working. (#1512)
- CI check that fails pull requests changing `src/templates/**` without a
  changelog entry, with a `skip-changelog` opt-out label. (#1519)

### Fixed

- `default` template `package.json` had a missing comma and a duplicate
  `lucide-react` entry, so scaffolded apps could not install and Jest could not
  resolve any file under the template.
- `src/mocks/wallet-contexts-mock.ts` declared `isUnsignedFeeBumpResult` twice,
  which stopped every test importing the mock from parsing.
