# Soroban Contract Setup & Deployment

This guide covers building, testing, and deploying Soroban contracts included in this template.

## Prerequisites

Before starting, ensure you have:

- **Rust 1.56+** - [Install Rust](https://www.rust-lang.org/tools/install)
- **Stellar CLI** - [Install CLI](https://github.com/stellar/js-stellar-sdk/releases)
- **soroban-cli** - Install with:
  ```bash
  cargo install --locked soroban-cli
  ```
- **Node.js 20+** - For the frontend templates

## Project Structure

```
contracts-template/
├── contracts/
│   ├── hello_world/
│   │   ├── src/lib.rs
│   │   ├── Cargo.toml
│   │   └── spec.json
│   ├── counter/
│   │   ├── src/lib.rs
│   │   ├── Cargo.toml
│   │   └── spec.json
│   └── Cargo.toml (workspace)
└── src/
    ├── lib/
    │   ├── contracts/
    │   │   └── index.ts
    │   └── bindings/
    │       ├── HelloWorld.ts
    │       └── Counter.ts
    └── app/
```

## Building Contracts

### Build All Contracts

```bash
# From the contracts directory
cd contracts-template/contracts

# Build all contracts in the workspace
cargo build --release --target wasm32-unknown-unknown
```

### Build Single Contract

```bash
# Build just the counter contract
cargo build -p counter --release --target wasm32-unknown-unknown
```

## Testing Contracts

Run Rust unit tests:

```bash
# Test all contracts
cargo test

# Test specific contract
cargo test -p counter

# Run tests with output
cargo test -- --nocapture
```

## Generating WASM Hash

After building, get the WASM hash for deployment:

```bash
# List compiled WASM files and their hashes
ls -la target/wasm32-unknown-unknown/release/*.wasm

# Get SHA-256 hash (needed for deployment)
sha256sum target/wasm32-unknown-unknown/release/counter.wasm
```

## Deploying to Testnet

### 1. Set Up Environment

Create a `.env` file in your app root:

```env
# Soroban network
NEXT_PUBLIC_SOROBAN_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK=TESTNET

# After deployment, add contract IDs
NEXT_PUBLIC_COUNTER_CONTRACT_ID=C...
NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C...
```

### 2. Deploy Contract using Stellar CLI

```bash
# Install contract (upload WASM to network)
soroban contract install \
  --network testnet \
  --source-account <YOUR_ACCOUNT> \
  --wasm target/wasm32-unknown-unknown/release/counter.wasm

# Deploy contract (create contract instance)
soroban contract deploy \
  --network testnet \
  --source-account <YOUR_ACCOUNT> \
  --wasm target/wasm32-unknown-unknown/release/counter.wasm \
  --salt <RANDOM_SALT> \
  --wasm-hash <WASM_HASH>
```

### 3. Update Environment Variables

Copy the returned contract ID (starts with `C...`) and add to `.env`:

```env
NEXT_PUBLIC_COUNTER_CONTRACT_ID=CBKN7IXVPQB4AAFQFGJPPVX7C6KRYZPJ5PQSCBZXKNJD2KZQKDMZNUQ
```

## Using in Frontend (DeFi Template)

### 1. Set Contract ID in Environment

In your app's `.env.local`:

```env
NEXT_PUBLIC_COUNTER_CONTRACT_ID=CBKN7IXVPQB4AAFQFGJPPVX7C6KRYZPJ5PQSCBZXKNJD2KZQKDMZNUQ
```

### 2. Use Generated Bindings

The `CounterDemo` component shows full integration:

```tsx
import { useSorobanContract } from '@/hooks/useSorobanContract';
import { CounterClient, CONTRACTS } from '@/lib/contracts';

function MyComponent() {
  const contract = useSorobanContract({
    contractId: CONTRACTS.COUNTER,
    network: 'TESTNET',
  });

  const client = new CounterClient(contract);
  
  // Call contract functions with full type safety
  const count = await client.getCount();
  await client.increment();
}
```

## Updating Contracts

### 1. Modify Contract Code

Edit `contracts/counter/src/lib.rs` with your changes.

### 2. Update Spec (if interface changed)

Edit `contracts/counter/spec.json` to match new functions.

### 3. Regenerate Bindings

```bash
npm run generate:bindings contracts/counter/spec.json --name Counter
```

### 4. Rebuild and Deploy

```bash
# Rebuild
cargo build -p counter --release --target wasm32-unknown-unknown

# Deploy with new salt to get new contract ID
soroban contract deploy ... --salt <NEW_SALT>
```

## Contract Validation Checklist

Before deploying to mainnet, verify:

- [ ] All unit tests pass: `cargo test`
- [ ] Contract builds without warnings: `cargo build --release --target wasm32-unknown-unknown`
- [ ] WASM size is reasonable (< 500KB for most contracts)
- [ ] Contract spec is complete and accurate
- [ ] TypeScript bindings generate without errors
- [ ] Frontend integration is tested on testnet
- [ ] Error handling is comprehensive
- [ ] All functions are properly documented

## Useful Commands Reference

```bash
# Build for wasm32 target
cargo build --release --target wasm32-unknown-unknown

# Run tests
cargo test

# Format code
cargo fmt

# Check for issues
cargo clippy

# Generate bindings (from app root)
npm run generate:bindings contracts/counter/spec.json

# Deploy to testnet
soroban contract deploy \
  --network testnet \
  --source-account <ACCOUNT> \
  --wasm path/to/contract.wasm \
  --salt <SALT>

# Invoke contract (test call)
soroban contract invoke \
  --network testnet \
  --id <CONTRACT_ID> \
  -- \
  get_count
```

## Troubleshooting

### "target/wasm32-unknown-unknown not found"

Make sure you have the wasm target installed:

```bash
rustup target add wasm32-unknown-unknown
```

### "soroban-cli not found"

Install the Soroban CLI:

```bash
cargo install --locked soroban-cli
```

### Contract deployment fails with "invalid account"

Ensure your account has XLM balance on testnet:

```bash
# Fund from testnet faucet
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
```

### Bindings generation error

Verify your spec.json is valid:

1. Check all functions have `inputs` and `outputs` arrays
2. All types match Soroban supported types (u32, u128, address, etc.)
3. No trailing commas or syntax errors
4. Run generator with proper path: `npm run generate:bindings <SPEC_PATH>`

## Next Steps

1. **Read Stellar docs** - [Soroban Guide](https://developers.stellar.org/docs/learn/smart-contracts)
2. **Explore examples** - Check hello_world and counter contracts
3. **Deploy to mainnet** - After thorough testnet testing
4. **Join community** - [Stellar Discord](https://discord.gg/stellar)

## Support

For issues or questions:

- [Stellar Developers Forum](https://stellar.stackexchange.com/)
- [GitHub Issues](https://github.com/stellar/rs-soroban-sdk/issues)
- [Discord Community](https://discord.gg/stellar)
