# Release Process

This project uses a fully automated release pipeline via GitHub Actions.

## How to publish a release

1. Ensure you are on the commit you want to release (typically `main`).

2. Create and push a **signed** tag matching the version in `package.json`:

   ```sh
   git tag -s v$(node -p "require('./package.json').version") -m "v$(node -p "require('./package.json').version")"
   git push origin v$(node -p "require('./package.json').version")
   ```

   The tag must follow the `v<semver>` format (e.g., `v1.0.5`). `-s` signs
   the tag with your GPG key (or SSH key when `gpg.format=ssh`); see
   [Signed git tags](#signed-git-tags) for one-time setup.

3. The [Release workflow](.github/workflows/release.yml) will:
   - Install dependencies (`npm ci`)
   - Run tests (`npm test`)
   - Typecheck (`tsc --noEmit`)
   - Build (`npm run build`)
   - Verify the tag matches `package.json` version
   - Guard against oversized packages
   - Generate an SBOM (`bom.json`)
   - Pack the tarball once and write `SHA256SUMS` for the tarball and SBOM
   - Sign build provenance for the tarball and SBOM (Sigstore, via
     `actions/attest-build-provenance`)
   - Publish that same tarball to npm with `--provenance`
   - Fail the release if the registry does not report provenance for the
     published version
   - Attach the tarball, `bom.json` and `SHA256SUMS` to the GitHub Release
     for the tag

## Signed release artifacts

Every release is cryptographically signed in three independent ways. None of
them use a long-lived signing key stored in the repository: npm provenance and
build attestations use short-lived Sigstore certificates issued to the release
workflow through GitHub OIDC (`id-token: write`).

| Artifact | Signature | How to verify |
| --- | --- | --- |
| npm package | npm provenance (SLSA provenance signed via Sigstore, published to the public transparency log) | `npm audit signatures` in a project that depends on `nextellar`, or the "Provenance" panel on npmjs.com |
| Tarball + SBOM on the GitHub Release | GitHub build provenance attestation | `gh attestation verify <file> --repo nextellarlabs/nextellar` |
| Release tag | GPG/SSH signed tag created by the maintainer | `git tag -v v<version>`, or the "Verified" badge on GitHub |

### Verifying a release

```sh
# npm provenance and registry signatures for installed packages
npm install nextellar@<version>
npm audit signatures

# Build provenance for a downloaded release asset
gh release download v<version> --repo nextellarlabs/nextellar
gh attestation verify nextellar-<version>.tgz --repo nextellarlabs/nextellar
gh attestation verify bom.json --repo nextellarlabs/nextellar
sha256sum -c SHA256SUMS

# Tag signature (requires the maintainer's public key)
git fetch --tags && git tag -v v<version>
```

The tarball attached to the GitHub Release is byte-for-byte the one published
to npm, so `SHA256SUMS` can also be compared with the `dist.integrity`/shasum
reported by `npm view nextellar@<version> dist`.

### Signed git tags

One-time setup for maintainers who cut releases:

```sh
# GPG
git config --global user.signingkey <KEY_ID>
# or SSH
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
```

Upload the public key to GitHub (Settings > SSH and GPG keys, as a signing
key) so the tag shows as "Verified". The workflow does not reject unsigned
tags, because verifying them in CI would require pinning every maintainer's
public key; signing tags is a maintainer step in this checklist.

### Requirements

- The workflow needs `id-token: write`, `attestations: write` and
  `contents: write`; these are set in `release.yml`.
- `NPM_TOKEN` must be an npm automation (or granular) token for an account
  with publish rights. Provenance only works when publishing from the
  workflow; a local `npm publish --provenance` fails by design.

## Dry-run

Test the pipeline without publishing by triggering the workflow manually:

1. Go to **Actions** > **Release** > **Run workflow**
2. Check **dry-run** and run on the target branch
3. The tarball and `SHA256SUMS` are uploaded as a build artifact. Nothing is
   attested, published, or attached to a release in a dry run, and the
   tag/version check is skipped because the run is not on a tag.

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Update `version` in `package.json` before tagging.
