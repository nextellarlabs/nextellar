# Troubleshooting Guide (Doctor-Driven)

Nextellar provides a built-in diagnostics command, `nextellar doctor`, to verify that your local development environment meets all prerequisites for scaffolding and developing full-stack Stellar applications.

When a setup or build error occurs, running `nextellar doctor` quickly isolates the root cause. This guide maps each diagnostic check ID to common failure symptoms, root causes, and step-by-step remediation procedures.

---

## Quick Reference: Running Diagnostics

Run the doctor command in your terminal:

```bash
# Interactive CLI diagnostic report
npx nextellar doctor

# Override Horizon or Soroban endpoints for probing
npx nextellar doctor --horizon-url https://horizon-testnet.stellar.org --soroban-url https://soroban-testnet.stellar.org

# Machine-readable JSON output for CI / automation
npx nextellar doctor --json
```

### Exit Codes & Severity

- **Exit code `0`**: All **required** checks passed. Optional toolchain items (e.g. Rust or alternative package managers) may report warnings but do not block general frontend development.
- **Exit code `1`**: One or more **required** checks failed. You must remediate the required failures before running `nextellar` scaffold or deploy commands.

| Check ID                                  | Name              | Severity     | Required For                                  |
| ----------------------------------------- | ----------------- | ------------ | --------------------------------------------- |
| [`node`](#node-nodejs)                    | Node.js           | **Required** | Running Nextellar CLI & Next.js runtime       |
| [`npm`](#npm-npm)                         | npm               | **Required** | Dependency installation & scripts             |
| [`yarn`](#yarn-yarn)                      | yarn              | Optional     | Alternative package manager                   |
| [`pnpm`](#pnpm-pnpm)                      | pnpm              | Optional     | Alternative package manager                   |
| [`git`](#git-git)                         | Git               | **Required** | Version control & repository initialization   |
| [`rustc`](#rustc-rust)                    | Rust              | Optional     | Soroban smart contract development            |
| [`stellar-cli`](#stellar-cli-stellar-cli) | Stellar CLI       | Optional     | Soroban contract build, test & deployment     |
| [`wasm32`](#wasm32-wasm32-target)         | wasm32 target     | Optional     | Compiling Rust contracts to WebAssembly       |
| [`horizon`](#horizon-horizon-api)         | Horizon API       | **Required** | Stellar account & transaction querying        |
| [`soroban`](#soroban-soroban-rpc)         | Soroban RPC       | Optional     | Smart contract JSON-RPC queries & simulations |
| [`disk`](#disk-free-memory-ram)           | Free Memory (RAM) | **Required** | Build processes, bundling & local compilation |

---

## Check Catalog & Remediation

### `node`: Node.js

- **Requirement**: Node.js `>= 20.0.0`
- **Severity**: Required

#### Common Failures

- `✖ Node.js v18.19.0 (>= 20.0.0 required)`
- `✖ Node.js Not installed`

#### Root Causes

- An older Node.js LTS or legacy release (e.g., Node 16 or 18) is active in your current shell session.
- Node.js is not installed or not present in `$PATH`.

#### How to Fix

**Using a Node Version Manager (Recommended):**

- **nvm** (macOS / Linux / WSL):

  ```bash
  nvm install 20
  nvm use 20
  nvm alias default 20
  ```

- **fnm** (Cross-platform):

  ```bash
  fnm install 20
  fnm use 20
  fnm default 20
  ```

- **n** (macOS / Linux):
  ```bash
  sudo n lts
  ```

**Package Managers & Direct Installers:**

- **macOS (Homebrew)**:
  ```bash
  brew install node@20
  brew link --overwrite node@20
  ```
- **Ubuntu / Debian**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **Windows / macOS Official Installer**: Download and install the LTS release from [nodejs.org](https://nodejs.org/).

---

### `npm`: npm

- **Requirement**: `npm` executable available in `$PATH`
- **Severity**: Required

#### Common Failures

- `✖ npm Not installed`

#### Root Causes

- Node.js installation was corrupted or installed without npm.
- Global npm binary path is missing from your system `$PATH` environment variable.

#### How to Fix

- npm is bundled automatically with Node.js. Reinstalling Node.js via [nodejs.org](https://nodejs.org/) or your version manager resolves most issues.
- Update or repair npm:
  ```bash
  npm install -g npm@latest
  ```

---

### `yarn`: yarn

- **Requirement**: `yarn` CLI available in `$PATH`
- **Severity**: Optional (only required if you use `--package-manager yarn`)

#### Common Failures

- `⚠ yarn Not installed`

#### Root Causes

- Yarn is not installed globally or Corepack has not been activated.

#### How to Fix

- **Enable via Node Corepack (Recommended)**:
  ```bash
  corepack enable
  corepack prepare yarn@stable --activate
  ```
- **Install globally via npm**:
  ```bash
  npm install -g yarn
  ```
- **macOS (Homebrew)**:
  ```bash
  brew install yarn
  ```

---

### `pnpm`: pnpm

- **Requirement**: `pnpm` CLI available in `$PATH`
- **Severity**: Optional (only required if you use `--package-manager pnpm`)

#### Common Failures

- `⚠ pnpm Not installed`

#### Root Causes

- pnpm is not installed globally or Corepack is not enabled.

#### How to Fix

- **Enable via Corepack**:
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
- **Install via Standalone Script**:
  ```bash
  # macOS / Linux
  curl -fsSL https://get.pnpm.io/install.sh | sh -

  # Windows (PowerShell)
  iwr https://get.pnpm.io/install.ps1 -useb | iex
  ```
- **Install globally via npm**:
  ```bash
  npm install -g pnpm
  ```

---

### `git`: Git

- **Requirement**: `git` executable available in `$PATH`
- **Severity**: Required

#### Common Failures

- `✖ Git Not installed`

#### Root Causes

- Git command-line tools are not installed on the system.
- On macOS, developer tools license prompt may have been bypassed or canceled.

#### How to Fix

- **macOS**:
  ```bash
  xcode-select --install
  # Or via Homebrew
  brew install git
  ```
- **Ubuntu / Debian**:
  ```bash
  sudo apt update && sudo apt install -y git
  ```
- **Fedora / RHEL**:
  ```bash
  sudo dnf install git
  ```
- **Windows**: Download and install [Git for Windows](https://git-scm.com/download/win).

---

### `rustc`: Rust

- **Requirement**: `rustc` compiler in `$PATH`
- **Severity**: Optional (required only when scaffolding with `--with-contracts` or developing Soroban smart contracts)

#### Common Failures

- `⚠ Rust Not installed (needed for contract development)`

#### Root Causes

- The Rust toolchain is not installed on your machine.

#### How to Fix

- **Install via rustup (All platforms)**:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- After installation, reload your shell environment:
  ```bash
  source "$HOME/.cargo/env"
  ```
- Verify installation:
  ```bash
  rustc --version
  cargo --version
  ```

---

### `stellar-cli`: Stellar CLI

- **Requirement**: `stellar` CLI in `$PATH`
- **Severity**: Optional (required for compiling, testing, optimizing, and deploying Soroban contracts)

#### Common Failures

- `⚠ Stellar CLI Not installed (needed for contract development)`

#### Root Causes

- The Stellar CLI cargo crate or binary is not installed or not in `$PATH`.

#### How to Fix

- **Install via Homebrew (macOS / Linux)**:
  ```bash
  brew install stellar-cli
  ```
- **Install via Cargo (requires Rust)**:
  ```bash
  cargo install --locked stellar-cli --features opt
  ```
- Ensure `~/.cargo/bin` is in your `$PATH`:
  ```bash
  export PATH="$HOME/.cargo/bin:$PATH"
  ```
- Verify:
  ```bash
  stellar --version
  ```

---

### `wasm32`: wasm32 Target

- **Requirement**: `wasm32-unknown-unknown` target installed via `rustup`
- **Severity**: Optional (required for compiling Soroban Rust contracts to WebAssembly)

#### Common Failures

- `⚠ wasm32 target Not installed`

#### Root Causes

- Rust is installed, but the WebAssembly target (`wasm32-unknown-unknown`) has not been added to the active toolchain.

#### How to Fix

- **Add the target via rustup**:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```
- Verify installed targets:
  ```bash
  rustup target list --installed
  ```

---

### `horizon`: Horizon API

- **Requirement**: Successful HTTP probe (`HEAD` or `GET`) to the configured Horizon endpoint
- **Severity**: Required

#### Common Failures

- `✖ Horizon API Unreachable: fetch failed (ECONNREFUSED / ETIMEDOUT)`
- `✖ Horizon API https://horizon-testnet.stellar.org (503 / 504)`

#### Root Causes

- No internet connection or network interface offline.
- Firewall, corporate proxy, or VPN blocking outbound connections to Stellar Horizon servers.
- Stellar testnet undergoing temporary maintenance or rate limiting.
- An invalid or typoed URL was configured in `.nextellar/config.json` or `--horizon-url`.

#### How to Fix

1. **Verify network connectivity**:
   ```bash
   curl -I https://horizon-testnet.stellar.org
   ```
2. **Override with an alternative or local endpoint**:
   ```bash
   npx nextellar doctor --horizon-url https://horizon-testnet.stellar.org
   ```
3. **Inspect custom configuration**:
   Check `.nextellar/config.json` in your project root and verify the `horizonUrl` field:
   ```json
   {
     "horizonUrl": "https://horizon-testnet.stellar.org"
   }
   ```
4. **Check Stellar Network Status**: Check official network status at [status.stellar.org](https://status.stellar.org/).

---

### `soroban`: Soroban RPC

- **Requirement**: Successful JSON-RPC `status` probe to the configured Soroban RPC endpoint
- **Severity**: Optional (required for contract calls, simulation, and bindings)

#### Common Failures

- `⚠ Soroban RPC Unreachable: fetch failed (ECONNREFUSED / ETIMEDOUT)`
- `⚠ Soroban RPC https://soroban-testnet.stellar.org (500 / 502)`

#### Root Causes

- Soroban RPC testnet node is temporarily unreachable or undergoing maintenance.
- Custom RPC endpoint specified in `.nextellar/config.json` or `--soroban-url` is invalid or offline.

#### How to Fix

1. **Verify RPC endpoint response**:
   ```bash
   curl -X POST https://soroban-testnet.stellar.org \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
   ```
2. **Override endpoint**:
   ```bash
   npx nextellar doctor --soroban-url https://soroban-testnet.stellar.org
   ```
3. **Configure custom RPC**:
   Update `.nextellar/config.json` or `.env.local` (`NEXT_PUBLIC_SOROBAN_URL`).

---

### `disk`: Free Memory (RAM)

- **Requirement**: At least `1,000,000,000` bytes (~1 GB) of free RAM available
- **Severity**: Required

#### Common Failures

- `✖ Free Memory (RAM) 420 MB RAM free`

#### Root Causes

- Machine is experiencing high memory pressure from background processes, local Docker containers, or IDE instances.
- Low-memory CI runners or virtual machines without sufficient allocated RAM.

#### How to Fix

- **Close memory-heavy processes**: Stop unneeded background containers (`docker stop ...`) or browser tabs.
- **Enable Swap Space on Linux/WSL**:
  ```bash
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  ```
- **CI / Docker Runners**: Increase runner container memory allocation to `>= 2 GB`.

---

## Common Scenarios & FAQs

### Scaffolding times out during dependency installation

If `npx nextellar <app-name>` times out when installing dependencies on slower network connections:

```bash
# Increase install timeout (in ms, e.g. 5 minutes)
npx nextellar my-app --install-timeout 300000

# Or skip install and run manually
npx nextellar my-app --skip-install
cd my-app && npm install
```

### Soroban contract binding generation fails

Ensure `rustc`, `stellar-cli`, and `wasm32` checks all pass:

```bash
npx nextellar doctor
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt
```

### Using Nextellar in CI/CD Environments

Run `nextellar doctor --json` in your workflow before build steps to catch missing dependencies early:

```yaml
# GitHub Actions snippet
- name: Run Nextellar Doctor Diagnostics
  run: npx nextellar doctor --json
```

---

## See Also

- [`nextellar doctor --json` Schema Specification](./doctor-json.md)
- [Network and Environment Configuration Guide](./network-environment-guide.md)
- [Soroban Contracts Overlay Guide](./soroban-contracts-overlay-guide.md)
- [Deployment Guide](./deploy-guide.md)
