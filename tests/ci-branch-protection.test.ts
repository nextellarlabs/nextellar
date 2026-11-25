import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CI_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "ci.yml");
const BRANCH_PROTECTION_PATH = path.join(ROOT, ".github", "branch-protection.json");

describe("CI workflow and branch protection wiring", () => {
  const workflowContent = readFileSync(CI_WORKFLOW_PATH, "utf8");
  const branchProtection = JSON.parse(readFileSync(BRANCH_PROTECTION_PATH, "utf8")) as {
    required_status_checks: {
      strict: boolean;
      contexts: string[];
    };
  };

  it("triggers CI on pull_request, push to main, and workflow_dispatch", () => {
    expect(workflowContent).toMatch(/^\s*pull_request:\s*$/m);
    expect(workflowContent).toMatch(/^\s*push:\s*\r?\n\s*branches:\s*\[main\]\s*$/m);
    expect(workflowContent).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });

  it("defines every required status check context as a job name in ci.yml", () => {
    const jobNames = Array.from(workflowContent.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)).map((m) =>
      m[1].trim(),
    );

    expect(branchProtection.required_status_checks.strict).toBe(true);
    expect(branchProtection.required_status_checks.contexts.length).toBeGreaterThan(0);

    for (const context of branchProtection.required_status_checks.contexts) {
      expect(jobNames).toContain(context);
    }
  });
});
