// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Preflight toolchain checks for scaffold (#908).
//!
//! Fails fast with actionable guidance when the local Node.js/npm toolchain
//! is too old to run the scaffolded project, instead of crashing mid-install.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PreflightResult {
  ok: boolean;
  failures: string[];
}

interface VersionCheck {
  ok: boolean;
  detail: string;
  fix: string;
}

function parseMajor(version: string): number | null {
  const match = version.match(/v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

/** Check the running Node.js major version (authoritative: process.version). */
export function checkNodeVersion(minMajor = 20): VersionCheck {
  const current = process.version || "";
  const major = parseMajor(current);
  if (major === null) {
    return {
      ok: false,
      detail: `Could not determine Node.js version (got "${current}")`,
      fix: `Install Node.js >= ${minMajor}: https://nodejs.org/`,
    };
  }
  if (major < minMajor) {
    return {
      ok: false,
      detail: `Node.js v${major} found, but >= v${minMajor} is required`,
      fix: `Upgrade Node.js to >= ${minMajor}: https://nodejs.org/`,
    };
  }
  return { ok: true, detail: `Node.js v${major} OK`, fix: "" };
}

type NpmRunner = () => Promise<{ stdout: string }>;

/** npm ships with Node; verify it is present and runnable. */
export async function checkNpmAvailable(
  runner: NpmRunner = () => execFileAsync("npm", ["--version"]),
): Promise<VersionCheck> {
  try {
    const { stdout } = await runner();
    const version = stdout.trim();
    if (!version) {
      return {
        ok: false,
        detail: "npm not found",
        fix: "npm comes with Node.js. Install Node: https://nodejs.org/",
      };
    }
    return { ok: true, detail: `npm v${version} OK`, fix: "" };
  } catch {
    return {
      ok: false,
      detail: "npm not found or not executable",
      fix: "npm comes with Node.js. Install Node: https://nodejs.org/",
    };
  }
}

let npmRunnerOverride: NpmRunner | undefined;

/** Test-only seam (#908): substitute the npm check runner. */
export function setNpmRunnerForTest(runner: NpmRunner | undefined): void {
  npmRunnerOverride = runner;
}

/** Skip the toolchain gate entirely (test-only). */
export function setPreflightDisabledForTest(disabled: boolean): void {
  preflightDisabled = disabled;
}

let preflightDisabled = false;

/**
 * Run both preflight checks; returns aggregated result.
 * Throws nothing — callers decide how to surface failures.
 */
export async function runPreflight(
  npmRunner?: NpmRunner,
  minNodeMajor = 20,
): Promise<PreflightResult> {
  if (preflightDisabled) return { ok: true, failures: [] };
  const effectiveRunner = npmRunner ?? npmRunnerOverride;
  const failures: string[] = [];

  const nodeCheck = checkNodeVersion(minNodeMajor);
  if (!nodeCheck.ok) failures.push(`${nodeCheck.detail}. ${nodeCheck.fix}`);

  const npmCheck = await checkNpmAvailable(effectiveRunner);
  if (!npmCheck.ok) failures.push(`${npmCheck.detail}. ${npmCheck.fix}`);

  return { ok: failures.length === 0, failures };
}
