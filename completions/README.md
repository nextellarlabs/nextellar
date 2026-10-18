# Nextellar Shell Completions

This directory contains shell completion scripts for the Nextellar CLI.

## Quick Installation

### Bash
```bash
echo 'source /path/to/nextellar/completions/nextellar-completion.bash' >> ~/.bashrc
source ~/.bashrc
```

### Zsh
```zsh
# Copy to your $fpath
mkdir -p ~/.zsh/completions
cp _nextellar ~/.zsh/completions/
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc
source ~/.zshrc
```

### Fish
```fish
mkdir -p ~/.config/fish/completions
cp nextellar.fish ~/.config/fish/completions/
fish_update_completions
```

### PowerShell
```powershell
Get-Content nextellar-completion.ps1 | Add-Content $PROFILE
. $PROFILE
```

## Full Documentation

For detailed installation instructions, troubleshooting, and more, see:
📖 [../docs/shell-completions.md](../docs/shell-completions.md)

## What's Included

- **nextellar-completion.bash** - Bash completion script
- **_nextellar** - Zsh completion script
- **nextellar.fish** - Fish completion script  
- **nextellar-completion.ps1** - PowerShell completion script

## Features

Tab completion for:
- All commands and subcommands
- Templates (default, minimal, defi, marketplace, nft, dao, payments)
- Features for `add` command (useWallet, useStellarAccount, etc.)
- Package managers (npm, yarn, pnpm, bun)
- Wallet adapters (freighter, xbull, albedo, lobstr)
- All command-line options and flags
