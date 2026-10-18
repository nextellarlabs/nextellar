# Shell Completions

Nextellar provides shell completion scripts for bash, zsh, fish, and PowerShell to enhance your CLI experience with tab completion for commands, options, and arguments.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
  - [Bash](#bash)
  - [Zsh](#zsh)
  - [Fish](#fish)
  - [PowerShell](#powershell)
- [Generating Completions](#generating-completions)
- [What's Completed](#whats-completed)
- [Troubleshooting](#troubleshooting)

## Features

Shell completions provide intelligent tab completion for:

- **Commands**: `doctor`, `status`, `templates`, `init`, `add`, `telemetry`, `upgrade`, `deploy`, `clean`
- **Templates**: `default`, `minimal`, `defi`, `marketplace`, `nft`, `dao`, `payments`
- **Features** (for `add` command): `useWallet`, `useStellarAccount`, `useStellarPayment`, `WalletButton`, etc.
- **Package managers**: `npm`, `yarn`, `pnpm`, `bun`
- **Wallet adapters**: `freighter`, `xbull`, `albedo`, `lobstr`
- **All command-line options and flags**

## Installation

### Bash

#### Option 1: Source in your `.bashrc` or `.bash_profile`

```bash
# Generate completions
npm run generate:completions bash

# Add to your shell profile
echo 'source /path/to/nextellar/completions/nextellar-completion.bash' >> ~/.bashrc

# Reload your shell
source ~/.bashrc
```

#### Option 2: System-wide installation

```bash
# Generate completions
npm run generate:completions bash

# Copy to bash completions directory (requires sudo)
sudo cp completions/nextellar-completion.bash /etc/bash_completion.d/nextellar

# Reload your shell
source ~/.bashrc
```

### Zsh

#### Option 1: Add to your `.zshrc`

```zsh
# Generate completions
npm run generate:completions zsh

# Add to your shell profile
echo 'source /path/to/nextellar/completions/_nextellar' >> ~/.zshrc

# Reload your shell
source ~/.zshrc
```

#### Option 2: Use $fpath (recommended)

```zsh
# Generate completions
npm run generate:completions zsh

# Copy to a directory in your $fpath
# Check your $fpath with: echo $fpath
mkdir -p ~/.zsh/completions
cp completions/_nextellar ~/.zsh/completions/

# Add to your .zshrc if not already present
echo 'fpath=(~/.zsh/completions $fpath)' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc

# Reload your shell
source ~/.zshrc
```

#### Option 3: System-wide installation

```zsh
# Generate completions
npm run generate:completions zsh

# Copy to system completions directory (requires sudo)
sudo cp completions/_nextellar /usr/local/share/zsh/site-functions/

# Clear completion cache and reload
rm -f ~/.zcompdump
exec zsh
```

### Fish

```fish
# Generate completions
npm run generate:completions fish

# Copy to fish completions directory
mkdir -p ~/.config/fish/completions
cp completions/nextellar.fish ~/.config/fish/completions/

# Reload completions (automatic in new shells)
fish_update_completions
```

### PowerShell

#### Windows PowerShell

```powershell
# Generate completions
npm run generate:completions powershell

# Check if you have a profile
Test-Path $PROFILE

# If false, create it
New-Item -Path $PROFILE -Type File -Force

# Add the completion script to your profile
Get-Content completions\nextellar-completion.ps1 | Add-Content $PROFILE

# Reload your profile
. $PROFILE
```

#### PowerShell Core (pwsh)

```powershell
# Generate completions
npm run generate:completions powershell

# Add to your PowerShell profile
Get-Content completions\nextellar-completion.ps1 | Add-Content $PROFILE.CurrentUserAllHosts

# Reload your profile
. $PROFILE.CurrentUserAllHosts
```

## Generating Completions

To generate shell completion scripts, use the following commands:

```bash
# Generate all completion scripts
npm run generate:completions

# Generate for a specific shell
npm run generate:completions bash
npm run generate:completions zsh
npm run generate:completions fish
npm run generate:completions powershell
```

Completion scripts are generated in the `completions/` directory at the project root.

## What's Completed

### Main Command

When creating a new project:

```bash
nextellar my-app --template <TAB>
# Completes: default minimal defi marketplace nft dao payments

nextellar my-app --package-manager <TAB>
# Completes: npm yarn pnpm bun

nextellar my-app --wallets <TAB>
# Completes: freighter xbull albedo lobstr
```

### Subcommands

```bash
nextellar <TAB>
# Completes: doctor status templates init add telemetry upgrade deploy clean
```

### `add` Command

```bash
nextellar add <TAB>
# Completes: useWallet useStellarAccount useStellarBalance useStellarPayment
#            useSorobanContract useAnchorAuth WalletButton AccountInfo
#            PaymentForm TokenBalance

nextellar add --<TAB>
# Completes: --list --force --skip-install --package-manager --dry-run
#            --verbose --debug
```

### `templates` Command

```bash
nextellar templates <TAB>
# Completes: default minimal defi marketplace nft dao payments

nextellar templates --<TAB>
# Completes: --json
```

### `telemetry` Command

```bash
nextellar telemetry <TAB>
# Completes: status enable disable
```

### `doctor` Command

```bash
nextellar doctor --<TAB>
# Completes: --json --fix --horizon-url --soroban-url
```

### `upgrade` Command

```bash
nextellar upgrade --<TAB>
# Completes: --dry-run --check --diff --yes --verbose --debug
```

## Troubleshooting

### Completions Not Working (Bash)

1. **Check bash-completion is installed**:
   ```bash
   # macOS
   brew install bash-completion@2
   
   # Ubuntu/Debian
   sudo apt-get install bash-completion
   
   # Fedora/RHEL
   sudo dnf install bash-completion
   ```

2. **Verify sourcing**:
   ```bash
   # Check if completion file is sourced
   grep nextellar ~/.bashrc
   ```

3. **Reload shell**:
   ```bash
   exec bash
   ```

### Completions Not Working (Zsh)

1. **Check compinit is loaded**:
   ```zsh
   # Add to ~/.zshrc if missing
   autoload -Uz compinit && compinit
   ```

2. **Clear completion cache**:
   ```zsh
   rm -f ~/.zcompdump*
   compinit
   ```

3. **Check $fpath**:
   ```zsh
   echo $fpath
   # Ensure the directory containing _nextellar is in the list
   ```

### Completions Not Working (Fish)

1. **Verify file location**:
   ```fish
   ls ~/.config/fish/completions/nextellar.fish
   ```

2. **Update completions**:
   ```fish
   fish_update_completions
   ```

3. **Restart Fish**:
   ```fish
   exec fish
   ```

### Completions Not Working (PowerShell)

1. **Check execution policy**:
   ```powershell
   Get-ExecutionPolicy
   
   # If Restricted, change it:
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

2. **Verify profile path**:
   ```powershell
   $PROFILE
   # Should show path to your profile
   ```

3. **Check if completion is registered**:
   ```powershell
   Get-ArgumentCompleter -CommandName nextellar
   ```

### Still Not Working?

1. **Regenerate completions**:
   ```bash
   npm run generate:completions
   ```

2. **Check shell is supported**:
   - Bash 4.0+
   - Zsh 5.0+
   - Fish 3.0+
   - PowerShell 5.1+ or PowerShell Core 7.0+

3. **Manual verification**:
   ```bash
   # Source the completion file directly
   source completions/nextellar-completion.bash  # bash
   source completions/_nextellar                 # zsh
   source completions/nextellar.fish             # fish
   . completions/nextellar-completion.ps1        # PowerShell
   ```

4. **Check for conflicts**:
   - Remove any old completion scripts for `nextellar`
   - Check for duplicate entries in your shell profile

## Development

If you're contributing to Nextellar and need to update completions:

1. Edit `bin/generate-completions.ts` to add new commands, options, or completions
2. Update the constants at the top:
   - `COMMANDS` - List of subcommands
   - `TEMPLATES` - Available templates
   - `FEATURES` - Features for the `add` command
   - `PACKAGE_MANAGERS` - Supported package managers
   - `WALLETS` - Supported wallet adapters

3. Regenerate completions:
   ```bash
   npm run generate:completions
   ```

4. Test in your shell:
   ```bash
   # Reload the completion script
   source completions/nextellar-completion.bash  # or your shell's file
   
   # Test tab completion
   nextellar <TAB>
   ```

## Contributing

Found a bug or missing completion? Please [open an issue](https://github.com/nextellarlabs/nextellar/issues) or submit a pull request!
