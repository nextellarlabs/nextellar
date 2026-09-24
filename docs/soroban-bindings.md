# Soroban Contract Binding Generator

Generate typed TypeScript client bindings from Soroban contract specifications to reduce boilerplate and provide type safety when interacting with smart contracts.

## Overview

The binding generator automates the creation of typed TypeScript clients from JSON contract specifications. Instead of manually writing XDR encoding/decoding code, the generated bindings provide:

- **Type-safe function signatures** matching your contract interface
- **Auto-generated argument and return type interfaces**
- **Proper XDR type hints** for complex types (u128, bytes, vectors, maps, enums)
- **Error code enumerations** for contract-defined error handling
- **Full documentation** from your contract spec comments

## Quick Start

### 1. Define Your Contract Spec

Create a `spec.json` file in your contract directory with the structure:

```json
{
  "type": "contract",
  "functions": [
    {
      "name": "transfer",
      "doc": "Transfer tokens from caller to recipient",
      "inputs": [
        {
          "name": "to",
          "type": "address",
          "doc": "Recipient account address"
        },
        {
          "name": "amount",
          "type": "u128",
          "doc": "Amount to transfer"
        }
      ],
      "outputs": [
        {
          "name": "success",
          "type": "bool"
        }
      ]
    }
  ],
  "errorCodes": [
    {
      "code": 1,
      "name": "InsufficientBalance",
      "doc": "Caller does not have enough balance"
    },
    {
      "code": 2,
      "name": "InvalidRecipient",
      "doc": "Recipient address is invalid"
    }
  ]
}
```

### 2. Generate Bindings

```bash
npx ts-node bin/generate-soroban-bindings.ts <spec-file> [--output <path>] [--name <contractName>]
```

**Examples:**

```bash
# Auto-detect output path and contract name
npx ts-node bin/generate-soroban-bindings.ts contracts/token/spec.json

# Custom output location
npx ts-node bin/generate-soroban-bindings.ts contracts/token/spec.json --output src/lib/bindings/token.ts

# Custom contract name
npx ts-node bin/generate-soroban-bindings.ts contracts/token/spec.json --name TokenContract
```

### 3. Use Generated Bindings

```tsx
import { useSorobanContract } from '@/hooks/useSorobanContract';
import { TokenContractClient } from '@/lib/bindings/TokenContract';
import { CONTRACTS } from '@/lib/contracts';

function TransferComponent() {
  const contract = useSorobanContract({
    contractId: CONTRACTS.TOKEN,
    network: 'TESTNET',
  });

  const client = new TokenContractClient(contract);

  const handleTransfer = async () => {
    try {
      const result = await client.transfer({
        to: 'GABC123...',
        amount: 1_000_000n, // 1 million tokens (assuming 6 decimals)
      });
      console.log('Transfer successful:', result);
    } catch (error) {
      console.error('Transfer failed:', error);
    }
  };

  return <button onClick={handleTransfer}>Transfer</button>;
}
```

## Supported Types

The binding generator converts Soroban types to TypeScript with automatic XDR type hints:

| Soroban Type | TypeScript Type | XDR Hint |
|---|---|---|
| `u32` | `number` | `"u32"` |
| `i32` | `number` | `"i32"` |
| `u64` | `bigint` | `"u64"` |
| `i64` | `bigint` | `"i64"` |
| `u128` | `bigint` | `"u128"` |
| `i128` | `bigint` | `"i128"` |
| `bool` | `boolean` | `"bool"` |
| `string` | `string` | `"string"` |
| `symbol` | `string` | `"symbol"` |
| `address` | `string` | `"address"` |
| `bytes` | `Uint8Array` | `"bytes"` |
| `vec<T>` | `T[]` | `"vec"` |
| `map<K,V>` | `Map<K,V>` | `"map"` |
| `option<T>` | `T \| null` | varies |
| `result<T,E>` | `{ok: T} \| {err: E}` | varies |
| `timepoint` | `number` | `"timepoint"` |
| `duration` | `number` | `"duration"` |

## Contract Spec Schema

### Root Object

```typescript
interface ContractSpec {
  type?: string;           // Optional: "contract"
  functions: Function[];   // Array of contract functions
  errorCodes?: ErrorCode[]; // Optional: error definitions
}
```

### Function Definition

```typescript
interface Function {
  name: string;              // Function name
  doc?: string;              // Documentation/comments
  inputs: Parameter[];       // Input parameters
  outputs: Parameter[];      // Return values
}
```

### Parameter Definition

```typescript
interface Parameter {
  name: string;   // Parameter name
  type: string;   // Soroban type (e.g., "u128", "vec<address>")
  doc?: string;   // Parameter documentation
}
```

### Error Code Definition

```typescript
interface ErrorCode {
  code: number;   // Error code number
  name: string;   // Error name (PascalCase)
  doc?: string;   // Error description
}
```

## Generated Code Structure

The generator creates a TypeScript file with:

### 1. Error Enumerations (if defined)

```typescript
export enum TokenContractErrors {
  InsufficientBalance = 1,
  InvalidRecipient = 2,
}
```

### 2. Argument Interfaces

```typescript
export interface TransferArgs {
  to: string;        // Recipient account address
  amount: bigint;    // Amount to transfer
}
```

### 3. Result Type Aliases

```typescript
export type TransferResult = boolean;
```

### 4. Client Class

```typescript
export class TokenContractClient {
  constructor(private contract: SorobanContractReturn) {}

  async transfer(args: TransferArgs): Promise<TransferResult> {
    // Auto-generated implementation
  }
}
```

## Example: HelloWorld Contract

The template includes an example `hello_world` contract with generated bindings:

**Spec** (`contracts/hello_world/spec.json`):
```json
{
  "functions": [
    {
      "name": "hello",
      "inputs": [{ "name": "to", "type": "symbol" }],
      "outputs": [{ "name": "greeting", "type": "vec<symbol>" }]
    }
  ]
}
```

**Generated Binding** (`src/lib/bindings/HelloWorld.ts`):
```typescript
export interface HelloArgs {
  to: string;
}

export type HelloResult = string[];

export class HelloWorldClient {
  async hello(args: HelloArgs): Promise<HelloResult> {
    // Automatically handles symbol → XDR conversion
  }
}
```

**Usage**:
```tsx
import { HelloWorldClient } from '@/lib/contracts';

const client = new HelloWorldClient(contract);
const greeting = await client.hello({ to: 'world' });
console.log(greeting); // ['Hello', 'world']
```

## Type Hints and Disambiguation

The generated bindings automatically apply correct XDR type hints. For complex types, the generator uses:

- **u128 for amounts**: BigInt values are correctly encoded as 128-bit unsigned
- **symbol for identifiers**: String values marked as symbols trigger proper XDR encoding
- **bytes for data**: Uint8Array/hex strings are encoded as byte arrays
- **vec for arrays**: TypeScript arrays map to Soroban vectors
- **address for accounts**: Account addresses auto-detect and convert to ScVal format

Example with multiple types:

```tsx
const result = await client.complexFunction({
  amount: 1_000_000n,           // u128
  recipient: 'GABC...',          // address
  metadata: new Uint8Array([...]), // bytes
  tags: ['urgent', 'transfer'],  // vec<string>
});
```

## Adding Bindings to Your Project

1. **Create your contract spec** in `contracts/{name}/spec.json`
2. **Run the generator** to create `src/lib/bindings/{Name}.ts`
3. **Export from contracts index** in `src/lib/contracts/index.ts`:
   ```typescript
   export { TokenContractClient } from '../bindings/TokenContract';
   ```
4. **Use in components** with proper typing and error handling

## Regenerating Bindings

After updating your contract spec, regenerate bindings:

```bash
npm run generate-bindings
```

Or manually for specific contracts:

```bash
npx ts-node bin/generate-soroban-bindings.ts contracts/token/spec.json --name TokenContract
```

The generator will overwrite the previous bindings file while preserving the contract logic in your Rust code.

## Best Practices

### 1. Keep Specs in Version Control

Store `spec.json` files alongside contract code:

```
contracts/
├── token/
│   ├── src/
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── spec.json          ← Version this
├── governance/
│   ├── src/
│   ├── Cargo.toml
│   └── spec.json
```

### 2. Document Your Specs

Use `doc` fields for clear documentation that appears in generated TypeScript:

```json
{
  "name": "transfer",
  "doc": "Transfer tokens from caller to recipient. Caller must approve this contract to spend tokens.",
  "inputs": [
    {
      "name": "to",
      "type": "address",
      "doc": "Must be a valid Stellar account (G...) or contract address (C...)"
    }
  ]
}
```

### 3. Use Error Codes

Define all error conditions in your spec for proper error handling:

```typescript
try {
  await client.transfer({ to, amount });
} catch (error) {
  if (error.code === TokenContractErrors.InsufficientBalance) {
    // Show insufficient balance UI
  }
}
```

### 4. Generate Bindings in CI

Add to your build pipeline to keep bindings synchronized with specs:

```yaml
- name: Generate Soroban Bindings
  run: npm run generate-bindings
```

## Troubleshooting

### "Invalid spec: missing functions array"

Ensure your `spec.json` has a top-level `functions` array:

```json
{
  "functions": [...]  // Required
}
```

### Type Mismatches

If you see type errors in generated code:

1. Verify all type names match supported Soroban types (see table above)
2. Check for typos in generic type syntax: `vec<symbol>`, not `vec[symbol]`
3. Regenerate bindings after updating specs

### Generated Code Not Found

Bindings are generated to `src/lib/bindings/` by default. Verify:

1. Output directory exists or is created by the generator
2. `--output` path is correct if using custom location
3. Contract name in imports matches the generated file

## Advanced: Custom Binding Hooks

For additional contract logic, extend the generated client:

```typescript
import { HelloWorldClient } from '@/lib/bindings/HelloWorld';

export class HelloWorldExtended extends HelloWorldClient {
  async helloWithRetry(args: HelloArgs, retries = 3): Promise<HelloResult> {
    for (let i = 0; i < retries; i++) {
      try {
        return await this.hello(args);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error('Unexpected');
  }
}
```

## See Also

- [Soroban Contract Development Guide](https://developers.stellar.org/docs/build/guides/soroban)
- [useSorobanContract Hook Documentation](./soroban-contract-hook.md)
- [Example Contracts](../src/templates/contracts-template/)
