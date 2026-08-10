# Release Process

This project uses a fully automated release pipeline via GitHub Actions.

## How to publish a release

1. Ensure you are on the commit you want to release (typically `main`).

2. Create and push a tag matching the version in `package.json`:

   ```sh
   git tag v$(node -p "require('./package.json').version")
   git push origin v$(node -p "require('./package.json').version")
   ```

   The tag must follow the `v<semver>` format (e.g., `v1.0.5`).

3. The [Release workflow](.github/workflows/release.yml) will:
   - Install dependencies (`npm ci`)
   - Run tests (`npm test`)
   - Typecheck (`tsc --noEmit`)
   - Build (`npm run build`)
   - Verify the tag matches `package.json` version
   - Guard against oversized packages
   - Publish to npm with provenance

## Dry-run

Test the pipeline without publishing by triggering the workflow manually:

1. Go to **Actions** > **Release** > **Run workflow**
2. Check **dry-run** and run on the target branch
3. The tarball will be uploaded as a build artifact

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Update `version` in `package.json` before tagging.
