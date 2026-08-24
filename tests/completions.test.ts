// Tests for shell completion generation (#909).

import { Command } from "commander";
import {
  collectCommandTree,
  generateBashCompletions,
  generateZshCompletions,
  generateCompletions,
} from "../src/lib/completions.js";

function buildTestProgram(): Command {
  const program = new Command();
  program.name("nextellar").description("Nextellar CLI").version("1.0.0");

  program
    .command("scaffold")
    .description("scaffold a new project")
    .option("--typescript")
    .option("--skip-install");
  program
    .command("doctor")
    .description("check toolchain health")
    .option("--json");
  program
    .command("upgrade")
    .description("upgrade an existing project");

  return program;
}

describe("shell completions (#909)", () => {
  test("collects the command tree", () => {
    const tree = collectCommandTree(buildTestProgram());
    const names = tree.subcommands.map((c) => c.name);
    expect(names).toContain("scaffold");
    expect(names).toContain("doctor");
    expect(names).toContain("upgrade");
  });

  test("bash completions include commands and complete function", () => {
    const script = generateBashCompletions(buildTestProgram());
    expect(script).toContain("_nextellar_completions");
    expect(script).toContain("complete -F _nextellar_completions nextellar");
    expect(script).toContain("scaffold");
    expect(script).toContain("doctor");
  });

  test("zsh completions include compdef and commands", () => {
    const script = generateZshCompletions(buildTestProgram());
    expect(script).toContain("#compdef nextellar");
    expect(script).toContain("_nextellar");
    expect(script).toContain("scaffold");
  });

  test("generateCompletions dispatches by shell name (case-insensitive)", () => {
    expect(generateCompletions("BASH", buildTestProgram())).toContain(
      "COMPREPLY",
    );
    expect(generateCompletions(" Zsh ", buildTestProgram())).toContain(
      "#compdef",
    );
  });

  test("throws on unsupported shell", () => {
    expect(() => generateCompletions("fish", buildTestProgram())).toThrow(
      /Unsupported shell/,
    );
  });
});
