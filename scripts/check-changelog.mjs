#!/usr/bin/env node
/**
 * Changelog gate for pull requests that touch the scaffolded templates.
 *
 * Template changes ship to every project generated afterwards, so they need a
 * changelog entry. This fails when a PR changes anything under
 * `src/templates/` without also changing `CHANGELOG.md`, unless the PR carries
 * the opt-out label `skip-changelog`.
 *
 * Inputs (environment variables, so nothing from the PR is interpolated into a shell):
 *   CHANGED_FILES  newline-separated list of paths changed by the PR
 *   PR_LABELS      JSON array of the PR's label names (default: none)
 *
 * Exit code 0 = ok / not applicable / opted out, 1 = changelog entry missing.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PREFIX = 'src/templates/';
export const CHANGELOG_FILE = 'CHANGELOG.md';
export const OPT_OUT_LABEL = 'skip-changelog';

const normalize = (file) => file.trim().replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * @param {{ changedFiles: string[], labels?: string[] }} input
 * @returns {{ ok: boolean, reason: string, templateFiles: string[] }}
 */
export function evaluateChangelog({ changedFiles, labels = [] }) {
  const files = changedFiles.map(normalize).filter(Boolean);
  const templateFiles = files.filter((file) => file.startsWith(TEMPLATE_PREFIX));

  if (templateFiles.length === 0) {
    return { ok: true, reason: 'No template files changed.', templateFiles };
  }
  if (files.includes(CHANGELOG_FILE)) {
    return { ok: true, reason: `${CHANGELOG_FILE} was updated.`, templateFiles };
  }
  if (labels.includes(OPT_OUT_LABEL)) {
    return { ok: true, reason: `Opted out with the "${OPT_OUT_LABEL}" label.`, templateFiles };
  }
  return {
    ok: false,
    reason:
      `Template files changed but ${CHANGELOG_FILE} was not updated. ` +
      `Add an entry under "Unreleased", or apply the "${OPT_OUT_LABEL}" label if no entry is needed.`,
    templateFiles,
  };
}

function parseLabels(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((label) => typeof label === 'string') : [];
  } catch {
    return [];
  }
}

function main() {
  const changedFiles = (process.env.CHANGED_FILES ?? '').split('\n');
  const labels = parseLabels(process.env.PR_LABELS);
  const result = evaluateChangelog({ changedFiles, labels });

  if (result.ok) {
    console.log(`Changelog check passed: ${result.reason}`);
    return 0;
  }

  console.error(`Changelog check failed: ${result.reason}`);
  console.error('Changed template files:');
  for (const file of result.templateFiles.slice(0, 20)) console.error(`  - ${file}`);
  if (result.templateFiles.length > 20) {
    console.error(`  ... and ${result.templateFiles.length - 20} more`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
