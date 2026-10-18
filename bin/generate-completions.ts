#!/usr/bin/env node
/**
 * Generate shell completion scripts for bash, zsh, and fish.
 * 
 * Usage:
 *   npx tsx bin/generate-completions.ts [shell]
 * 
 * If no shell is specified, generates all completion scripts.
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMANDS = [
  "doctor",
  "status",
  "templates",
  "init",
  "add",
  "telemetry",
  "upgrade",
  "deploy",
  "clean",
];

const TEMPLATES = [
  "default",
  "minimal",
  "defi",
  "marketplace",
  "nft",
  "dao",
  "payments",
];

const FEATURES = [
  "useWallet",
  "useStellarAccount",
  "useStellarBalance",
  "useStellarPayment",
  "useSorobanContract",
  "useAnchorAuth",
  "WalletButton",
  "AccountInfo",
  "PaymentForm",
  "TokenBalance",
];

const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"];

const WALLETS = ["freighter", "xbull", "albedo", "lobstr"];

/**
 * Generate bash completion script
 */
function generateBashCompletion(): string {
  return `# bash completion for nextellar
# To install: source this file or add it to your .bashrc

_nextellar_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${COMMANDS.join(" ")}"

  # Complete commands
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  # Get the subcommand
  local subcommand="\${COMP_WORDS[1]}"

  case "$subcommand" in
    add)
      case "$prev" in
        add)
          COMPREPLY=( $(compgen -W "${FEATURES.join(" ")} --list --force --skip-install --package-manager --dry-run --verbose --debug" -- "$cur") )
          ;;
        --package-manager)
          COMPREPLY=( $(compgen -W "${PACKAGE_MANAGERS.join(" ")}" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "--list --force --skip-install --package-manager --dry-run --verbose --debug" -- "$cur") )
          ;;
      esac
      ;;
    templates)
      case "$prev" in
        templates)
          COMPREPLY=( $(compgen -W "${TEMPLATES.join(" ")} --json" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "--json" -- "$cur") )
          ;;
      esac
      ;;
    telemetry)
      COMPREPLY=( $(compgen -W "status enable disable" -- "$cur") )
      ;;
    doctor)
      COMPREPLY=( $(compgen -W "--json --fix --horizon-url --soroban-url" -- "$cur") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "--defaults" -- "$cur") )
      ;;
    upgrade)
      COMPREPLY=( $(compgen -W "--dry-run --check --diff --yes --verbose --debug" -- "$cur") )
      ;;
    deploy)
      COMPREPLY=( $(compgen -W "--dry-run --size-threshold --verbose --debug" -- "$cur") )
      ;;
    clean)
      # No options for clean
      ;;
    *)
      # Main command options when creating a new project
      case "$prev" in
        --template)
          COMPREPLY=( $(compgen -W "${TEMPLATES.join(" ")}" -- "$cur") )
          ;;
        --package-manager)
          COMPREPLY=( $(compgen -W "${PACKAGE_MANAGERS.join(" ")}" -- "$cur") )
          ;;
        --wallets|-w)
          COMPREPLY=( $(compgen -W "${WALLETS.join(" ")}" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "-t --typescript -j --javascript --template --horizon-url --soroban-url -w --wallets -d --defaults -y --yes --skip-install --package-manager -c --with-contracts --force --no-git --git-init --install-timeout --no-telemetry --verbose --debug -v --version -h --help" -- "$cur") )
          ;;
      esac
      ;;
  esac

  return 0
}

complete -F _nextellar_completions nextellar
`;
}

/**
 * Generate zsh completion script
 */
function generateZshCompletion(): string {
  return `#compdef nextellar
# zsh completion for nextellar
# To install: place this file in your $fpath (e.g., /usr/local/share/zsh/site-functions/_nextellar)

_nextellar() {
  local context state state_descr line
  typeset -A opt_args

  local -a commands
  commands=(
    'doctor:Run environment diagnostics'
    'status:Show project health score'
    'templates:Preview template file trees'
    'init:Reconfigure network and wallet settings'
    'add:Add a Stellar feature to an existing project'
    'telemetry:Manage anonymous telemetry settings'
    'upgrade:Upgrade project to latest template files'
    'deploy:Validate and prepare deployment bundle'
    'clean:Remove build artifacts'
  )

  local -a templates
  templates=(${TEMPLATES.map((t) => `'${t}'`).join(" ")})

  local -a features
  features=(${FEATURES.map((f) => `'${f}'`).join(" ")})

  local -a package_managers
  package_managers=(${PACKAGE_MANAGERS.map((pm) => `'${pm}'`).join(" ")})

  local -a wallets
  wallets=(${WALLETS.map((w) => `'${w}'`).join(" ")})

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args' \\
    && return 0

  case $state in
    command)
      _describe -t commands 'nextellar commands' commands
      _arguments \\
        '1:project-name:' \\
        '(-t --typescript)'{-t,--typescript}'[Generate TypeScript project (default)]' \\
        '(-j --javascript)'{-j,--javascript}'[Generate JavaScript project]' \\
        '--template[Project template]:template:($templates)' \\
        '--horizon-url[Custom Horizon endpoint]:url:' \\
        '--soroban-url[Custom Soroban RPC endpoint]:url:' \\
        '(-w --wallets)'{-w,--wallets}'[Comma-separated wallet adapters]:wallets:($wallets)' \\
        '(-d --defaults)'{-d,--defaults}'[Skip prompts and use defaults]' \\
        '(-y --yes)'{-y,--yes}'[Alias for --defaults]' \\
        '--skip-install[Skip dependency installation]' \\
        '--package-manager[Choose package manager]:manager:($package_managers)' \\
        '(-c --with-contracts)'{-c,--with-contracts}'[Scaffold Soroban smart contracts]' \\
        '--force[Overwrite existing directory]' \\
        '--no-git[Skip git repository initialization]' \\
        '--git-init[Explicitly initialize git repository]' \\
        '--install-timeout[Timeout in ms for package install]:milliseconds:' \\
        '--no-telemetry[Disable telemetry]' \\
        '--verbose[Print additional diagnostic output]' \\
        '--debug[Alias for --verbose]' \\
        '(-v --version)'{-v,--version}'[Output version]' \\
        '(-h --help)'{-h,--help}'[Show help]'
      ;;
    args)
      case $line[1] in
        doctor)
          _arguments \\
            '--json[Output results as JSON]' \\
            '--fix[Offer to auto-fix check failures]' \\
            '--horizon-url[Horizon endpoint to check]:url:' \\
            '--soroban-url[Soroban RPC endpoint to check]:url:'
          ;;
        status)
          _arguments \\
            '--json[Output results as JSON]'
          ;;
        templates)
          _arguments \\
            '1:template:($templates)' \\
            '--json[Output as JSON]'
          ;;
        init)
          _arguments \\
            '(-d --defaults)'{-d,--defaults}'[Skip prompts and keep defaults]'
          ;;
        add)
          _arguments \\
            '1:feature:($features)' \\
            '--list[Show all available features]' \\
            '--force[Overwrite existing files]' \\
            '--skip-install[Skip installing dependencies]' \\
            '--package-manager[Package manager]:manager:($package_managers)' \\
            '--dry-run[Simulate without writing files]' \\
            '--verbose[Print additional diagnostic output]' \\
            '--debug[Alias for --verbose]'
          ;;
        telemetry)
          _arguments \\
            '1:action:(status enable disable)'
          ;;
        upgrade)
          _arguments \\
            '--dry-run[Show what would change]' \\
            '--check[Dry preview with changelog]' \\
            '--diff[Print full file-by-file diff]' \\
            '--yes[Apply changes without prompting]' \\
            '--verbose[Print additional diagnostic output]' \\
            '--debug[Alias for --verbose]'
          ;;
        deploy)
          _arguments \\
            '--dry-run[Validate without bundling]' \\
            '--size-threshold[Bundle size threshold in bytes]:bytes:' \\
            '--verbose[Print additional diagnostic output]' \\
            '--debug[Alias for --verbose]'
          ;;
        clean)
          # No options
          ;;
      esac
      ;;
  esac
}

_nextellar "$@"
`;
}

/**
 * Generate fish completion script
 */
function generateFishCompletion(): string {
  return `# fish completion for nextellar
# To install: place this file in ~/.config/fish/completions/nextellar.fish

# Disable file completion by default
complete -c nextellar -f

# Main commands
complete -c nextellar -n "__fish_use_subcommand" -a "doctor" -d "Run environment diagnostics"
complete -c nextellar -n "__fish_use_subcommand" -a "status" -d "Show project health score"
complete -c nextellar -n "__fish_use_subcommand" -a "templates" -d "Preview template file trees"
complete -c nextellar -n "__fish_use_subcommand" -a "init" -d "Reconfigure network and wallet settings"
complete -c nextellar -n "__fish_use_subcommand" -a "add" -d "Add a Stellar feature"
complete -c nextellar -n "__fish_use_subcommand" -a "telemetry" -d "Manage telemetry settings"
complete -c nextellar -n "__fish_use_subcommand" -a "upgrade" -d "Upgrade project to latest template"
complete -c nextellar -n "__fish_use_subcommand" -a "deploy" -d "Prepare deployment bundle"
complete -c nextellar -n "__fish_use_subcommand" -a "clean" -d "Remove build artifacts"

# Global options (when creating new project)
complete -c nextellar -n "__fish_use_subcommand" -s t -l typescript -d "Generate TypeScript project"
complete -c nextellar -n "__fish_use_subcommand" -s j -l javascript -d "Generate JavaScript project"
complete -c nextellar -n "__fish_use_subcommand" -l template -d "Project template" -xa "${TEMPLATES.join(" ")}"
complete -c nextellar -n "__fish_use_subcommand" -l horizon-url -d "Custom Horizon endpoint"
complete -c nextellar -n "__fish_use_subcommand" -l soroban-url -d "Custom Soroban RPC endpoint"
complete -c nextellar -n "__fish_use_subcommand" -s w -l wallets -d "Wallet adapters" -xa "${WALLETS.join(" ")}"
complete -c nextellar -n "__fish_use_subcommand" -s d -l defaults -d "Skip prompts, use defaults"
complete -c nextellar -n "__fish_use_subcommand" -s y -l yes -d "Alias for --defaults"
complete -c nextellar -n "__fish_use_subcommand" -l skip-install -d "Skip dependency installation"
complete -c nextellar -n "__fish_use_subcommand" -l package-manager -d "Package manager" -xa "${PACKAGE_MANAGERS.join(" ")}"
complete -c nextellar -n "__fish_use_subcommand" -s c -l with-contracts -d "Scaffold Soroban contracts"
complete -c nextellar -n "__fish_use_subcommand" -l force -d "Overwrite existing directory"
complete -c nextellar -n "__fish_use_subcommand" -l no-git -d "Skip git initialization"
complete -c nextellar -n "__fish_use_subcommand" -l git-init -d "Initialize git repository"
complete -c nextellar -n "__fish_use_subcommand" -l install-timeout -d "Package install timeout (ms)"
complete -c nextellar -n "__fish_use_subcommand" -l no-telemetry -d "Disable telemetry"
complete -c nextellar -n "__fish_use_subcommand" -l verbose -d "Additional diagnostic output"
complete -c nextellar -n "__fish_use_subcommand" -l debug -d "Alias for --verbose"
complete -c nextellar -n "__fish_use_subcommand" -s v -l version -d "Output version"
complete -c nextellar -n "__fish_use_subcommand" -s h -l help -d "Show help"

# doctor command
complete -c nextellar -n "__fish_seen_subcommand_from doctor" -l json -d "Output as JSON"
complete -c nextellar -n "__fish_seen_subcommand_from doctor" -l fix -d "Auto-fix check failures"
complete -c nextellar -n "__fish_seen_subcommand_from doctor" -l horizon-url -d "Horizon endpoint to check"
complete -c nextellar -n "__fish_seen_subcommand_from doctor" -l soroban-url -d "Soroban RPC endpoint to check"

# status command
complete -c nextellar -n "__fish_seen_subcommand_from status" -l json -d "Output as JSON"

# templates command
complete -c nextellar -n "__fish_seen_subcommand_from templates" -l json -d "Output as JSON"
complete -c nextellar -n "__fish_seen_subcommand_from templates" -a "${TEMPLATES.join(" ")}"

# init command
complete -c nextellar -n "__fish_seen_subcommand_from init" -s d -l defaults -d "Skip prompts, keep defaults"

# add command
complete -c nextellar -n "__fish_seen_subcommand_from add" -l list -d "Show all available features"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l force -d "Overwrite existing files"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l skip-install -d "Skip installing dependencies"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l package-manager -d "Package manager" -xa "${PACKAGE_MANAGERS.join(" ")}"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l dry-run -d "Simulate without writing"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l verbose -d "Additional diagnostic output"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l debug -d "Alias for --verbose"
complete -c nextellar -n "__fish_seen_subcommand_from add" -a "${FEATURES.join(" ")}"

# telemetry command
complete -c nextellar -n "__fish_seen_subcommand_from telemetry" -a "status" -d "Show telemetry status"
complete -c nextellar -n "__fish_seen_subcommand_from telemetry" -a "enable" -d "Enable telemetry"
complete -c nextellar -n "__fish_seen_subcommand_from telemetry" -a "disable" -d "Disable telemetry"

# upgrade command
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l dry-run -d "Show what would change"
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l check -d "Dry preview with changelog"
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l diff -d "Print full diff"
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l yes -d "Apply without prompting"
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l verbose -d "Additional diagnostic output"
complete -c nextellar -n "__fish_seen_subcommand_from upgrade" -l debug -d "Alias for --verbose"

# deploy command
complete -c nextellar -n "__fish_seen_subcommand_from deploy" -l dry-run -d "Validate without bundling"
complete -c nextellar -n "__fish_seen_subcommand_from deploy" -l size-threshold -d "Bundle size threshold (bytes)"
complete -c nextellar -n "__fish_seen_subcommand_from deploy" -l verbose -d "Additional diagnostic output"
complete -c nextellar -n "__fish_seen_subcommand_from deploy" -l debug -d "Alias for --verbose"

# clean command has no options
`;
}

/**
 * Generate PowerShell completion script
 */
function generatePowerShellCompletion(): string {
  return `# PowerShell completion for nextellar
# To install: Add to your PowerShell profile ($PROFILE)
# Example: Add-Content $PROFILE (Get-Content path\\to\\nextellar-completion.ps1)

Register-ArgumentCompleter -Native -CommandName nextellar -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(
        'doctor',
        'status',
        'templates',
        'init',
        'add',
        'telemetry',
        'upgrade',
        'deploy',
        'clean'
    )

    $templates = @(${TEMPLATES.map((t) => `'${t}'`).join(", ")})
    $features = @(${FEATURES.map((f) => `'${f}'`).join(", ")})
    $packageManagers = @(${PACKAGE_MANAGERS.map((pm) => `'${pm}'`).join(", ")})
    $wallets = @(${WALLETS.map((w) => `'${w}'`).join(", ")})

    $ast = $commandAst.ToString()
    $tokens = $ast -split '\\s+'

    # If we're completing the first argument (command or project name)
    if ($tokens.Count -le 2) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    $subcommand = $tokens[1]

    switch ($subcommand) {
        'add' {
            if ($wordToComplete -like '--*') {
                @('--list', '--force', '--skip-install', '--package-manager', '--dry-run', '--verbose', '--debug') |
                    Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                    }
            }
            elseif ($tokens[-2] -eq '--package-manager') {
                $packageManagers | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            else {
                $features | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'templates' {
            if ($wordToComplete -like '--*') {
                @('--json') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
            }
            else {
                $templates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'telemetry' {
            @('status', 'enable', 'disable') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'doctor' {
            @('--json', '--fix', '--horizon-url', '--soroban-url') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        'status' {
            @('--json') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'init' {
            @('-d', '--defaults') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'upgrade' {
            @('--dry-run', '--check', '--diff', '--yes', '--verbose', '--debug') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        'deploy' {
            @('--dry-run', '--size-threshold', '--verbose', '--debug') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        default {
            # Main command options
            if ($tokens[-2] -eq '--template') {
                $templates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($tokens[-2] -eq '--package-manager') {
                $packageManagers | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($tokens[-2] -in @('-w', '--wallets')) {
                $wallets | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($wordToComplete -like '--*' -or $wordToComplete -like '-*') {
                @('-t', '--typescript', '-j', '--javascript', '--template', '--horizon-url', '--soroban-url',
                  '-w', '--wallets', '-d', '--defaults', '-y', '--yes', '--skip-install', '--package-manager',
                  '-c', '--with-contracts', '--force', '--no-git', '--git-init', '--install-timeout',
                  '--no-telemetry', '--verbose', '--debug', '-v', '--version', '-h', '--help') |
                    Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                    }
            }
        }
    }
}
`;
}

/**
 * Main function to generate completions
 */
async function main() {
  const args = process.argv.slice(2);
  const shell = args[0]?.toLowerCase();

  const completionsDir = path.join(__dirname, "..", "completions");
  await fs.ensureDir(completionsDir);

  const generators: Record<string, { fn: () => string; filename: string }> = {
    bash: {
      fn: generateBashCompletion,
      filename: "nextellar-completion.bash",
    },
    zsh: {
      fn: generateZshCompletion,
      filename: "_nextellar",
    },
    fish: {
      fn: generateFishCompletion,
      filename: "nextellar.fish",
    },
    powershell: {
      fn: generatePowerShellCompletion,
      filename: "nextellar-completion.ps1",
    },
  };

  if (shell && shell in generators) {
    // Generate specific shell
    const { fn, filename } = generators[shell];
    const content = fn();
    const filepath = path.join(completionsDir, filename);
    await fs.writeFile(filepath, content, "utf8");
    console.log(`✓ Generated ${shell} completion: ${filepath}`);
  } else if (shell) {
    console.error(
      `Unknown shell: ${shell}. Supported: ${Object.keys(generators).join(", ")}`,
    );
    process.exit(1);
  } else {
    // Generate all
    for (const [shellName, { fn, filename }] of Object.entries(generators)) {
      const content = fn();
      const filepath = path.join(completionsDir, filename);
      await fs.writeFile(filepath, content, "utf8");
      console.log(`✓ Generated ${shellName} completion: ${filepath}`);
    }
  }

  console.log("\n✓ Shell completions generated successfully!");
}

main().catch((err) => {
  console.error("Error generating completions:", err);
  process.exit(1);
});
