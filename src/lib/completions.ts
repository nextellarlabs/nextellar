// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Shell completion generation for the Nextellar CLI (#909).
//!
//! Emits bash/zsh completion scripts for all commands, subcommands and
//! options registered in the Commander program.

import type { Command } from "commander";

interface CommandInfo {
  name: string;
  description: string;
  options: string[];
  subcommands: CommandInfo[];
}

/** Walk a Commander program and extract a serializable command tree. */
export function collectCommandTree(cmd: Command): CommandInfo {
  const options = (cmd.options ?? []).map((o) => o.long || o.short || "");
  const subcommands: CommandInfo[] = [];
  for (const sub of cmd.commands ?? []) {
    if ((sub as unknown as { _hidden?: boolean })._hidden === true) continue;
    subcommands.push(collectCommandTree(sub));
  }
  return {
    name: cmd.name(),
    description: cmd.description() || "",
    options: options.filter(Boolean),
    subcommands,
  };
}

/** Generate a bash completion script. */
export function generateBashCompletions(root: Command): string {
  const tree = collectCommandTree(root);

  const topLevelCommands = tree.subcommands.map((s) => s.name);
  const globalFlags = tree.options;

  // Per-command completion functions
  const perCommandFns = tree.subcommands
    .map((sub) => {
      const flags = sub.options.map((o) => o).join(" ");
      return `__nextellar_complete_${sub.name.replace(/[^a-z0-9_]/gi, "_")}() {
  COMPREPLY=( $(compgen -W "${flags} --help" -- "$cur") )
}`;
    })
    .join("\n\n");

  const caseBranches = tree.subcommands
    .map((sub) => {
      const fnName = sub.name.replace(/[^a-z0-9_]/gi, "_");
      return `    ${sub.name})
      __nextellar_complete_${fnName}
      ;;`;
    })
    .join("\n");

  return `# bash completion for nextellar
# Source this file or add to your ~/.bashrc:
#   source <(nextellar completions bash)

_nextellar_completions() {
  local cur prev commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${topLevelCommands.join(" ")}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${commands} ${globalFlags.join(" ")} --help --version" -- "\$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
${caseBranches}
  esac
}

complete -F _nextellar_completions nextellar
`;
}

/** Generate a zsh completion script (compdef style). */
export function generateZshCompletions(root: Command): string {
  const tree = collectCommandTree(root);
  const topLevelCommands = tree.subcommands.map((s) => s.name);
  const globalFlags = tree.options.map((f) => `[--help]help`);

  const commandBlocks = tree.subcommands
    .map((sub) => {
      const opts = sub.options
        .map((o) => `(\\--${o.replace(/^--/, "")})"[option]"`)
        .join(" ");
      return `  (${sub.name})
    _arguments \\
      ${opts ? `${opts} \\` : ""}
      "1:arg"
;;`;
    })
    .join("\n");

  return `#compdef nextellar
# zsh completion for nextellar
# Add to your fpath or eval: source <(nextellar completions zsh)

_nextellar() {
  local curcontext="\${curcontext}" state line
  typeset -A opt_args

  _arguments \\
    "1:command:->command" \\
    "*::option:->option"

  case $state in
    command)
      _values "command" \\
${tree.subcommands.map((s) => `        "${s.name}[${s.description.replace(/"/g, "'")}"]`).join(" \\\\\n")}
        "--help[show help]"
      ;;
    option)
      case $line[1] in
${commandBlocks}
      esac
      ;;
  esac
}

_nextellar "$@"
`;
}

/**
 * Entry point used by the `completions <shell>` CLI subcommand.
 * Returns the script for the requested shell.
 */
export function generateCompletions(
  shell: "bash" | "zsh",
  root: Command,
): string {
  switch (shell.toLowerCase().trim()) {
    case "bash":
      return generateBashCompletions(root);
    case "zsh":
      return generateZshCompletions(root);
    default:
      throw new Error(
        `Unsupported shell "${shell}". Supported shells: bash, zsh.`,
      );
  }
}
