import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { recordAuditEvent } from "./audit-log.js";
import { PROJECT_CONFIG_SCHEMA_VERSION } from "./project-config.js";

export type ContractTemplate = "hello" | "counter";

export interface AddContractOptions {
  /** Project root (default: process.cwd()) */
  cwd?: string;
  /** Contract starter template (default: "hello") */
  template?: ContractTemplate;
  /** Simulate without writing files */
  dryRun?: boolean;
}

export interface ContractConfigEntry {
  name: string;
  path: string;
  bindings: string;
  hook: string;
  docs: string;
  template: ContractTemplate;
  addedAt: string;
}

export interface AddContractResult {
  success: boolean;
  message?: string;
  contractName?: string;
  filesCreated?: string[];
  filesUpdated?: string[];
}

const VALID_TEMPLATES: readonly ContractTemplate[] = ["hello", "counter"];

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "abstract",
  "become",
  "box",
  "do",
  "final",
  "macro",
  "override",
  "priv",
  "try",
  "typeof",
  "unsized",
  "virtual",
  "yield",
]);

const CONTRACT_NAME_REGEX = /^[a-z][a-z0-9_]*$/;
const MAX_CONTRACT_NAME_LENGTH = 64;

/**
 * Validate a Soroban contract / Rust crate name.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateContractName(name: string): string | null {
  if (typeof name !== "string" || name.trim().length === 0) {
    return "Contract name is required.";
  }

  const trimmed = name.trim();
  if (trimmed !== name) {
    return `Invalid contract name "${name}": must not have leading or trailing whitespace.`;
  }

  if (trimmed.length > MAX_CONTRACT_NAME_LENGTH) {
    return `Invalid contract name "${name}": must be at most ${MAX_CONTRACT_NAME_LENGTH} characters.`;
  }

  if (!CONTRACT_NAME_REGEX.test(trimmed)) {
    return `Invalid contract name "${name}": must start with a lowercase letter and contain only lowercase letters, digits, and underscores (snake_case, e.g. "my_token").`;
  }

  if (trimmed.endsWith("_") || trimmed.includes("__")) {
    return `Invalid contract name "${name}": must not end with an underscore or contain consecutive underscores.`;
  }

  if (RUST_KEYWORDS.has(trimmed)) {
    return `Invalid contract name "${name}": "${trimmed}" is a reserved Rust keyword.`;
  }

  return null;
}

/**
 * Convert a snake_case contract name to PascalCase (e.g. "my_token" -> "MyToken").
 */
export function toPascalCase(snakeName: string): string {
  return snakeName
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Parse existing workspace members from a Cargo.toml string.
 */
export function parseWorkspaceMembers(cargoToml: string): string[] {
  const membersMatch = cargoToml.match(/members\s*=\s*\[([\s\S]*?)\]/);
  if (!membersMatch) return [];
  const inner = membersMatch[1];
  const members: string[] = [];
  const itemRegex = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(inner)) !== null) {
    members.push(match[1]);
  }
  return members;
}

/**
 * Register a new member in a Cargo.toml workspace manifest.
 * Throws if the member is already present or if `[workspace]` / `members` cannot be updated.
 */
export function registerWorkspaceMember(
  cargoToml: string,
  memberName: string,
): string {
  const existing = parseWorkspaceMembers(cargoToml);
  if (existing.includes(memberName)) {
    throw new Error(
      `Contract "${memberName}" is already registered in contracts/Cargo.toml.`,
    );
  }

  const membersRegex = /(members\s*=\s*\[)([\s\S]*?)(\])/;
  const match = cargoToml.match(membersRegex);
  if (match) {
    const updatedMembers = [...existing, memberName];
    const formatted =
      "members = [\n" +
      updatedMembers.map((m) => `    "${m}",`).join("\n") +
      "\n]";
    return cargoToml.replace(membersRegex, formatted);
  }

  if (/\[workspace\]/.test(cargoToml)) {
    return cargoToml.replace(
      /(\[workspace\][^\n]*\n)/,
      `$1members = [\n    "${memberName}",\n]\n`,
    );
  }

  return (
    `[workspace]\nresolver = "2"\nmembers = [\n    "${memberName}",\n]\n\n` +
    cargoToml
  );
}

function generateWorkspaceCargoToml(memberName: string): string {
  return `[workspace]
resolver = "2"
members = [
    "${memberName}",
]

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true

[profile.release-with-logs]
inherits = "release"
debug-assertions = true
`;
}

function generateContractCargoToml(name: string): string {
  return `[package]
name = "${name}"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[features]
testutils = ["soroban-sdk/testutils"]

[dependencies]
soroban-sdk = "22.0.0"

[dev-dependencies]
soroban-sdk = { version = "22.0.0", features = ["testutils"] }
`;
}

function generateContractLibRs(
  pascalName: string,
  template: ContractTemplate,
): string {
  if (template === "counter") {
    return `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

const COUNTER: Symbol = symbol_short!("COUNTER");

#[contract]
pub struct ${pascalName}Contract;

#[contractimpl]
impl ${pascalName}Contract {
    pub fn increment(env: Env) -> u32 {
        let mut count: u32 = env.storage().instance().get(&COUNTER).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&COUNTER, &count);
        count
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&COUNTER).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_increment() {
        let env = Env::default();
        let contract_id = env.register(${pascalName}Contract, ());
        let client = ${pascalName}ContractClient::new(&env, &contract_id);
        assert_eq!(client.get_count(), 0);
        assert_eq!(client.increment(), 1);
        assert_eq!(client.get_count(), 1);
    }
}
`;
  }

  return `#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Env, Symbol, Vec};

#[contract]
pub struct ${pascalName}Contract;

#[contractimpl]
impl ${pascalName}Contract {
    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {
        vec![&env, symbol_short!("Hello"), to]
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{symbol_short, vec, Env};

    #[test]
    fn test_hello() {
        let env = Env::default();
        let contract_id = env.register(${pascalName}Contract, ());
        let client = ${pascalName}ContractClient::new(&env, &contract_id);
        let words = client.hello(&symbol_short!("Dev"));
        assert_eq!(words, vec![&env, symbol_short!("Hello"), symbol_short!("Dev")]);
    }
}
`;
}

function generateContractSpec(template: ContractTemplate): string {
  if (template === "counter") {
    return JSON.stringify(
      {
        type: "contract",
        functions: [
          {
            name: "increment",
            doc: "Increments the counter and returns the new value",
            inputs: [],
            outputs: [{ name: "count", type: "u32" }],
          },
          {
            name: "get_count",
            doc: "Returns the current counter value",
            inputs: [],
            outputs: [{ name: "count", type: "u32" }],
          },
        ],
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      type: "contract",
      functions: [
        {
          name: "hello",
          doc: "Greets a recipient by returning a vector of symbols",
          inputs: [
            {
              name: "to",
              type: "symbol",
              doc: "The recipient symbol to greet",
            },
          ],
          outputs: [{ name: "greeting", type: "vec<symbol>" }],
        },
      ],
    },
    null,
    2,
  );
}

function generateBindingsTs(
  pascalName: string,
  template: ContractTemplate,
): string {
  if (template === "counter") {
    return `/**
 * Auto-generated Soroban contract bindings for ${pascalName}
 *
 * Provides typed client methods for interacting with the ${pascalName} contract.
 * Use with the useSorobanContract hook or use${pascalName}Contract hook.
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

export type IncrementResult = number;
export type GetCountResult = number;

/**
 * Typed client for ${pascalName} contract interactions
 */
export class ${pascalName}Client {
  constructor(private contract: SorobanContractReturn) {}

  /**
   * Increments the counter and returns the new value
   */
  async increment(): Promise<IncrementResult> {
    const callArgs: TypedArg[] = [];
    const result = await this.contract.callFunction('increment', callArgs);
    return result as IncrementResult;
  }

  /**
   * Returns the current counter value
   */
  async getCount(): Promise<GetCountResult> {
    const callArgs: TypedArg[] = [];
    const result = await this.contract.callFunction('get_count', callArgs);
    return result as GetCountResult;
  }
}
`;
  }

  return `/**
 * Auto-generated Soroban contract bindings for ${pascalName}
 *
 * Provides typed client methods for interacting with the ${pascalName} contract.
 * Use with the useSorobanContract hook or use${pascalName}Contract hook.
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

/**
 * Arguments for hello function
 */
export interface HelloArgs {
  to: string;
}

/**
 * Return value for hello function
 */
export type HelloResult = string[];

/**
 * Typed client for ${pascalName} contract interactions
 */
export class ${pascalName}Client {
  constructor(private contract: SorobanContractReturn) {}

  /**
   * Greets a recipient by returning a vector of symbols
   */
  async hello(args: HelloArgs): Promise<HelloResult> {
    const callArgs: TypedArg[] = [{ value: args.to, type: 'symbol' }];
    const result = await this.contract.callFunction('hello', callArgs);
    return result as HelloResult;
  }
}
`;
}

function generateHookTs(name: string, pascalName: string): string {
  const envVar = `NEXT_PUBLIC_${name.toUpperCase()}_CONTRACT_ID`;
  return `import { useMemo } from 'react';
import {
  useSorobanContract,
  type SorobanContractConfig,
} from '@/hooks/useSorobanContract';
import { ${pascalName}Client } from '@/lib/bindings/${pascalName}';

export interface Use${pascalName}ContractOptions
  extends Omit<SorobanContractConfig, 'contractId'> {
  /** Override contract ID (defaults to ${envVar}) */
  contractId?: string;
}

/**
 * React hook for interacting with the ${pascalName} Soroban contract.
 */
export function use${pascalName}Contract(
  options: Use${pascalName}ContractOptions = {},
) {
  const contractId =
    options.contractId ||
    process.env.${envVar} ||
    'C_REPLACE_WITH_YOUR_CONTRACT_ID';

  const contract = useSorobanContract({
    ...options,
    contractId,
  });

  const client = useMemo(() => new ${pascalName}Client(contract), [contract]);

  return {
    ...contract,
    client,
  };
}
`;
}

function generateContractDocs(
  name: string,
  pascalName: string,
  template: ContractTemplate,
): string {
  const envVar = `NEXT_PUBLIC_${name.toUpperCase()}_CONTRACT_ID`;
  const usageCall =
    template === "counter"
      ? `const count = await client.increment();`
      : `const greeting = await client.hello({ to: 'world' });`;

  return `# ${pascalName} Contract

Soroban smart contract scaffolded with \`nextellar add-contract ${name}\`.

## Build & Test

\`\`\`bash
# Build WASM
npm run contracts:build

# Run Rust unit tests
npm run contracts:test
\`\`\`

## Deploy

\`\`\`bash
stellar contract deploy \\
  --wasm contracts/target/wasm32-unknown-unknown/release/${name}.wasm \\
  --source alice \\
  --network testnet
\`\`\`

Set the deployed contract ID in \`.env.local\`:

\`\`\`env
${envVar}=C...
\`\`\`

## Usage in React

\`\`\`tsx
import { use${pascalName}Contract } from '@/hooks/use${pascalName}Contract';

export function ${pascalName}Demo() {
  const { client, loading, error } = use${pascalName}Contract({
    network: 'TESTNET',
  });

  const handleCall = async () => {
    ${usageCall}
  };

  return (
    <button onClick={handleCall} disabled={loading}>
      Call ${pascalName}
    </button>
  );
}
\`\`\`

## Generated Files

- \`contracts/${name}/Cargo.toml\` — Rust crate manifest
- \`contracts/${name}/src/lib.rs\` — Soroban contract implementation & unit tests
- \`contracts/${name}/spec.json\` — Contract interface specification
- \`src/lib/bindings/${pascalName}.ts\` — Typed TypeScript client (\`${pascalName}Client\`)
- \`src/hooks/use${pascalName}Contract.ts\` — React hook (\`use${pascalName}Contract\`)
`;
}

/**
 * Check if a contract name is already registered in `.nextellar/config.json`.
 */
function hasConfigContract(
  config: Record<string, unknown>,
  name: string,
): boolean {
  if (!Array.isArray(config.contracts)) return false;
  return config.contracts.some((entry) => {
    if (typeof entry === "string") return entry === name;
    if (entry && typeof entry === "object" && "name" in entry) {
      return (entry as { name?: unknown }).name === name;
    }
    return false;
  });
}

/**
 * Scaffold a new Soroban contract in an existing Nextellar project:
 * - Validates contract name and checks for duplicates
 * - Creates `contracts/<name>` from a template
 * - Registers it in `contracts/Cargo.toml` workspace
 * - Updates `.nextellar/config.json`
 * - Generates TS bindings, React hook, and contract docs
 */
export async function runAddContract(
  contractName: string,
  options: AddContractOptions = {},
): Promise<AddContractResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const dryRun = !!options.dryRun;
  const template: ContractTemplate = options.template ?? "hello";

  if (!VALID_TEMPLATES.includes(template)) {
    return {
      success: false,
      message: `Unknown contract template "${template}". Available templates: ${VALID_TEMPLATES.join(", ")}.`,
    };
  }

  const nameError = validateContractName(contractName);
  if (nameError) {
    return { success: false, message: nameError };
  }

  const pkgPath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(pkgPath))) {
    return {
      success: false,
      message:
        "No package.json found in the current directory. Run this from your Nextellar project root.",
    };
  }

  const pascalName = toPascalCase(contractName);
  const contractsDir = path.join(cwd, "contracts");
  const contractDir = path.join(contractsDir, contractName);
  const workspaceCargoPath = path.join(contractsDir, "Cargo.toml");
  const bindingsRelPath = `src/lib/bindings/${pascalName}.ts`;
  const hookRelPath = `src/hooks/use${pascalName}Contract.ts`;
  const docsRelPath = `contracts/${contractName}/README.md`;
  const bindingsAbsPath = path.join(cwd, bindingsRelPath);
  const hookAbsPath = path.join(cwd, hookRelPath);
  const configPath = path.join(cwd, ".nextellar", "config.json");

  // Conflict / duplicate checks
  if (await fs.pathExists(contractDir)) {
    return {
      success: false,
      message: `Contract directory "contracts/${contractName}" already exists.`,
    };
  }

  let existingWorkspaceToml: string | null = null;
  if (await fs.pathExists(workspaceCargoPath)) {
    const tomlContent = await fs.readFile(workspaceCargoPath, "utf8");
    existingWorkspaceToml = tomlContent;
    const members = parseWorkspaceMembers(tomlContent);
    if (members.includes(contractName)) {
      return {
        success: false,
        message: `Contract "${contractName}" is already registered in contracts/Cargo.toml.`,
      };
    }
  }

  let existingConfig: Record<string, unknown> | null = null;
  if (await fs.pathExists(configPath)) {
    existingConfig = await fs.readJson(configPath).catch(() => ({}));
    if (existingConfig && hasConfigContract(existingConfig, contractName)) {
      return {
        success: false,
        message: `Contract "${contractName}" is already registered in .nextellar/config.json.`,
      };
    }
  }

  if (await fs.pathExists(bindingsAbsPath)) {
    return {
      success: false,
      message: `Bindings file "${bindingsRelPath}" already exists.`,
    };
  }

  if (await fs.pathExists(hookAbsPath)) {
    return {
      success: false,
      message: `Hook file "${hookRelPath}" already exists.`,
    };
  }

  const filesCreated: string[] = [
    `contracts/${contractName}/Cargo.toml`,
    `contracts/${contractName}/src/lib.rs`,
    `contracts/${contractName}/spec.json`,
    docsRelPath,
    bindingsRelPath,
    hookRelPath,
  ];
  const filesUpdated: string[] = [];

  if (existingWorkspaceToml !== null) {
    filesUpdated.push("contracts/Cargo.toml");
  } else {
    filesCreated.push("contracts/Cargo.toml");
  }

  if (existingConfig !== null) {
    filesUpdated.push(".nextellar/config.json");
  } else {
    filesCreated.push(".nextellar/config.json");
  }

  if (!dryRun) {
    // 1. Create contract crate files
    await fs.ensureDir(path.join(contractDir, "src"));
    await fs.writeFile(
      path.join(contractDir, "Cargo.toml"),
      generateContractCargoToml(contractName),
      "utf8",
    );
    await fs.writeFile(
      path.join(contractDir, "src", "lib.rs"),
      generateContractLibRs(pascalName, template),
      "utf8",
    );
    await fs.writeFile(
      path.join(contractDir, "spec.json"),
      generateContractSpec(template) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(cwd, docsRelPath),
      generateContractDocs(contractName, pascalName, template),
      "utf8",
    );

    // 2. Register in Cargo workspace
    const nextWorkspaceToml =
      existingWorkspaceToml !== null
        ? registerWorkspaceMember(existingWorkspaceToml, contractName)
        : generateWorkspaceCargoToml(contractName);
    await fs.writeFile(workspaceCargoPath, nextWorkspaceToml, "utf8");

    // 3. Generate TS bindings and React hook
    await fs.ensureDir(path.dirname(bindingsAbsPath));
    await fs.writeFile(
      bindingsAbsPath,
      generateBindingsTs(pascalName, template),
      "utf8",
    );

    await fs.ensureDir(path.dirname(hookAbsPath));
    await fs.writeFile(
      hookAbsPath,
      generateHookTs(contractName, pascalName),
      "utf8",
    );

    // 4. Update .nextellar/config.json
    const now = new Date().toISOString();
    const baseConfig: Record<string, unknown> = existingConfig
      ? { ...existingConfig }
      : {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          nextellarVersion: "unknown",
          template: "default",
          createdAt: now,
        };
    const existingContracts = Array.isArray(baseConfig.contracts)
      ? [...baseConfig.contracts]
      : [];
    const newEntry: ContractConfigEntry = {
      name: contractName,
      path: `contracts/${contractName}`,
      bindings: bindingsRelPath,
      hook: hookRelPath,
      docs: docsRelPath,
      template,
      addedAt: now,
    };
    baseConfig.contracts = [...existingContracts, newEntry];
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeJson(configPath, baseConfig, { spaces: 2 });

    // 5. Ensure package.json has contracts scripts if missing
    const pkgJson = await fs.readJson(pkgPath);
    pkgJson.scripts = pkgJson.scripts || {};
    let pkgChanged = false;
    if (!pkgJson.scripts["contracts:build"]) {
      pkgJson.scripts["contracts:build"] =
        "cd contracts && stellar contract build";
      pkgChanged = true;
    }
    if (!pkgJson.scripts["contracts:test"]) {
      pkgJson.scripts["contracts:test"] = "cd contracts && cargo test";
      pkgChanged = true;
    }
    if (pkgChanged) {
      await fs.writeJson(pkgPath, pkgJson, { spaces: 2 });
      filesUpdated.push("package.json");
    }

    await recordAuditEvent(cwd, "add-contract", {
      contractName,
      template,
      filesCreated,
      filesUpdated,
    });
  }

  const lines: string[] = [];
  if (dryRun) {
    lines.push(
      pc.yellow("[dry-run] ") +
        pc.bold(
          `Simulating addition of contract "${contractName}". No files written.`,
        ),
    );
  } else {
    lines.push(
      pc.green("✔") + " " + pc.bold(`Contract "${contractName}" added.`),
    );
  }
  lines.push("");
  lines.push(pc.dim(dryRun ? "Files that would be created:" : "Created:"));
  filesCreated.forEach((f) => lines.push(`  ${f}`));
  if (filesUpdated.length > 0) {
    lines.push("");
    lines.push(pc.dim(dryRun ? "Files that would be updated:" : "Updated:"));
    filesUpdated.forEach((f) => lines.push(`  ${f}`));
  }
  console.log(lines.join("\n"));

  return {
    success: true,
    contractName,
    filesCreated,
    filesUpdated,
  };
}
