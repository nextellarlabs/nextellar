# fish completion for nextellar
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
complete -c nextellar -n "__fish_use_subcommand" -l template -d "Project template" -xa "default minimal defi marketplace nft dao payments"
complete -c nextellar -n "__fish_use_subcommand" -l horizon-url -d "Custom Horizon endpoint"
complete -c nextellar -n "__fish_use_subcommand" -l soroban-url -d "Custom Soroban RPC endpoint"
complete -c nextellar -n "__fish_use_subcommand" -s w -l wallets -d "Wallet adapters" -xa "freighter xbull albedo lobstr"
complete -c nextellar -n "__fish_use_subcommand" -s d -l defaults -d "Skip prompts, use defaults"
complete -c nextellar -n "__fish_use_subcommand" -s y -l yes -d "Alias for --defaults"
complete -c nextellar -n "__fish_use_subcommand" -l skip-install -d "Skip dependency installation"
complete -c nextellar -n "__fish_use_subcommand" -l package-manager -d "Package manager" -xa "npm yarn pnpm bun"
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
complete -c nextellar -n "__fish_seen_subcommand_from templates" -a "default minimal defi marketplace nft dao payments"

# init command
complete -c nextellar -n "__fish_seen_subcommand_from init" -s d -l defaults -d "Skip prompts, keep defaults"

# add command
complete -c nextellar -n "__fish_seen_subcommand_from add" -l list -d "Show all available features"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l force -d "Overwrite existing files"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l skip-install -d "Skip installing dependencies"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l package-manager -d "Package manager" -xa "npm yarn pnpm bun"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l dry-run -d "Simulate without writing"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l verbose -d "Additional diagnostic output"
complete -c nextellar -n "__fish_seen_subcommand_from add" -l debug -d "Alias for --verbose"
complete -c nextellar -n "__fish_seen_subcommand_from add" -a "useWallet useStellarAccount useStellarBalance useStellarPayment useSorobanContract useAnchorAuth WalletButton AccountInfo PaymentForm TokenBalance"

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
