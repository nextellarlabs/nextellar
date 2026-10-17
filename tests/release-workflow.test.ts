import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

// Guards the release-signing setup (#1127). The workflow is read as text and
// split into steps so the checks do not depend on a YAML parser.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/release.yml"),
  "utf8",
);
const releasing = fs.readFileSync(path.join(ROOT, "RELEASING.md"), "utf8");

/** Maps each `- name:` step to its block of text. */
function steps(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = source.split(/\r?\n(?=\s{6}- name: )/);
  for (const part of parts.slice(1)) {
    const name = part.match(/- name: (.+)/)?.[1].trim();
    if (name) map.set(name, part);
  }
  return map;
}

/** Top-level `permissions:` block as a key -> value map. */
function permissions(source: string): Record<string, string> {
  const block = source.match(/^permissions:\r?\n((?:\s{2}\S.*\r?\n)+)/m);
  if (!block) return {};
  return Object.fromEntries(
    block[1]
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.trim().split(/:\s*/) as [string, string]),
  );
}

const releaseSteps = steps(workflow);
const stepNames = [...releaseSteps.keys()];
const step = (name: string) => {
  const found = releaseSteps.get(name);
  if (!found) throw new Error(`release.yml has no step named "${name}"`);
  return found;
};

describe("release signing (#1127)", () => {
  it("grants the OIDC, attestation and release permissions signing needs", () => {
    expect(permissions(workflow)).toMatchObject({
      "id-token": "write",
      attestations: "write",
      contents: "write",
    });
  });

  it("packs one tarball and writes checksums for it and the SBOM", () => {
    const pack = step("Create tarball and checksums");
    expect(pack).toContain("id: pack");
    expect(pack).not.toMatch(/if:/);
    expect(pack).toMatch(/sha256sum "\$TARBALL" bom\.json > SHA256SUMS/);
    expect(pack).toContain('echo "tarball=$TARBALL" >> "$GITHUB_OUTPUT"');
  });

  it("signs build provenance for the tarball and SBOM before publishing", () => {
    const attest = step("Sign build provenance for release artifacts");
    expect(attest).toContain("uses: actions/attest-build-provenance@v2");
    expect(attest).toContain("${{ steps.pack.outputs.tarball }}");
    expect(attest).toContain("bom.json");
    expect(attest).toContain("if: ${{ !inputs.dry-run }}");
    expect(
      stepNames.indexOf("Sign build provenance for release artifacts"),
    ).toBeLessThan(stepNames.indexOf("Publish to npm"));
  });

  it("publishes the attested tarball itself with npm provenance", () => {
    const publish = step("Publish to npm");
    expect(publish).toMatch(
      /npm publish "\$\{\{ steps\.pack\.outputs\.tarball \}\}" --provenance --access public/,
    );
    expect(publish).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  });

  it("fails the release when the registry reports no provenance", () => {
    const verify = step("Verify npm provenance was recorded");
    expect(verify).toContain("dist.attestations");
    expect(verify).toContain("exit 1");
    expect(
      stepNames.indexOf("Verify npm provenance was recorded"),
    ).toBeGreaterThan(stepNames.indexOf("Publish to npm"));
  });

  it("attaches the signed tarball, SBOM and checksums to the tag's GitHub Release only", () => {
    const release = step("Attach signed artifacts to GitHub Release");
    expect(release).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(release).toContain("!inputs.dry-run");
    expect(release).toMatch(
      /gh release create "\$GITHUB_REF_NAME" "\$TARBALL" bom\.json SHA256SUMS/,
    );
    expect(release).toMatch(
      /gh release upload "\$GITHUB_REF_NAME" "\$TARBALL" bom\.json SHA256SUMS --clobber/,
    );
  });

  it("does not sign, publish or release during a dry run", () => {
    for (const name of [
      "Sign build provenance for release artifacts",
      "Publish to npm",
      "Verify npm provenance was recorded",
      "Attach signed artifacts to GitHub Release",
    ]) {
      expect(step(name)).toContain("!inputs.dry-run");
    }
    expect(step("Upload tarball")).toContain("if: ${{ inputs.dry-run }}");
  });

  it("only checks the tag/version match on tag runs, so dry runs on a branch work", () => {
    expect(step("Verify tag matches package.json")).toContain(
      "if: ${{ startsWith(github.ref, 'refs/tags/v') }}",
    );
  });

  it("documents signing and verification in RELEASING.md", () => {
    expect(releasing).toContain("## Signed release artifacts");
    expect(releasing).toContain("git tag -s");
    expect(releasing).toContain("npm audit signatures");
    expect(releasing).toContain("gh attestation verify");
    expect(releasing).toContain("sha256sum -c SHA256SUMS");
  });
});
