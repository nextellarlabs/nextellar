#!/usr/bin/env node
/**
 * Soroban Contract Binding Generator
 * 
 * Generates typed TypeScript client bindings from Soroban contract specs.
 * 
 * Usage:
 *   npx ts-node bin/generate-soroban-bindings.ts <spec-file> [--output <path>]
 * 
 * Example:
 *   npx ts-node bin/generate-soroban-bindings.ts contracts/hello_world/spec.json --output src/lib/bindings/hello_world.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

interface ContractSpec {
  type?: string;
  functions: ContractFunction[];
  errorCodes?: ErrorCode[];
}

interface ContractFunction {
  name: string;
  inputs: Parameter[];
  outputs: Parameter[];
  doc?: string;
}

interface Parameter {
  name: string;
  type: string;
  doc?: string;
}

interface ErrorCode {
  code: number;
  name: string;
  doc?: string;
}

interface BindingGeneratorOptions {
  specPath: string;
  outputPath: string;
  contractName?: string;
}

/**
 * Convert Soroban type to TypeScript type
 */
function sorobanTypeToTs(sorobanType: string): string {
  const typeMap: Record<string, string> = {
    'u32': 'number',
    'i32': 'number',
    'u64': 'bigint',
    'i64': 'bigint',
    'u128': 'bigint',
    'i128': 'bigint',
    'bool': 'boolean',
    'string': 'string',
    'symbol': 'string',
    'address': 'string',
    'bytes': 'Uint8Array',
    'timepoint': 'number',
    'duration': 'number',
  };

  // Handle generic types
  if (sorobanType.startsWith('vec<')) {
    const inner = sorobanType.slice(4, -1);
    return `${sorobanTypeToTs(inner)}[]`;
  }
  if (sorobanType.startsWith('option<')) {
    const inner = sorobanType.slice(7, -1);
    return `${sorobanTypeToTs(inner)} | null`;
  }
  if (sorobanType.startsWith('result<')) {
    // result<T, E> -> { ok: T } | { err: E }
    const parts = sorobanType.slice(7, -1).split(',').map(s => s.trim());
    const okType = sorobanTypeToTs(parts[0]);
    const errType = parts[1] ? sorobanTypeToTs(parts[1]) : 'string';
    return `{ ok: ${okType} } | { err: ${errType} }`;
  }

  return typeMap[sorobanType] || 'unknown';
}

/**
 * Convert Soroban type to TypeScript type hint for useSorobanContract
 */
function sorobanTypeToHint(sorobanType: string): string {
  const hintMap: Record<string, string> = {
    'u32': '"u32"',
    'i32': '"i32"',
    'u64': '"u64"',
    'i64': '"i64"',
    'u128': '"u128"',
    'i128': '"i128"',
    'bool': '"bool"',
    'string': '"string"',
    'symbol': '"symbol"',
    'address': '"address"',
    'bytes': '"bytes"',
    'timepoint': '"timepoint"',
    'duration': '"duration"',
  };

  if (sorobanType.startsWith('vec<')) {
    return '"vec"';
  }
  if (sorobanType.startsWith('map<')) {
    return '"map"';
  }

  return hintMap[sorobanType] || '"unknown"';
}

/**
 * Generate function argument interface
 */
function generateFunctionArgs(fn: ContractFunction): string {
  if (fn.inputs.length === 0) {
    return 'Record<string, never>';
  }

  const fields = fn.inputs
    .map(
      (param) =>
        `  ${param.name}: ${sorobanTypeToTs(param.type)}; ${
          param.doc ? `// ${param.doc}` : ''
        }`
    )
    .join('\n');

  return `{\n${fields}\n}`;
}

/**
 * Generate TypeScript binding code
 */
function generateBindings(spec: ContractSpec, contractName: string = 'Contract'): string {
  const timestamp = new Date().toISOString();

  let code = `/**
 * Auto-generated Soroban contract bindings for ${contractName}
 * Generated: ${timestamp}
 * 
 * This file provides typed client methods for interacting with the ${contractName} contract.
 * Use the generated functions with useSorobanContract hook for proper XDR encoding/decoding.
 * 
 * @example
 * \`\`\`tsx
 * import { useSorobanContract } from '@/hooks/useSorobanContract';
 * import { ${contractName}Client } from '@/lib/bindings/${contractName.toLowerCase()}';
 * 
 * function MyComponent() {
 *   const contract = useSorobanContract({
 *     contractId: 'CXXXX...',
 *     network: 'TESTNET',
 *   });
 * 
 *   const client = new ${contractName}Client(contract);
 *   const result = await client.someFunction({ arg1: 'value' });
 * }
 * \`\`\`
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

`;

  // Generate error codes enum if present
  if (spec.errorCodes && spec.errorCodes.length > 0) {
    code += `/**
 * Error codes for this contract
 */
export enum ${contractName}Errors {\n`;
    for (const err of spec.errorCodes) {
      code += `  /** ${err.doc || 'Error'} */\n`;
      code += `  ${err.name} = ${err.code},\n`;
    }
    code += `}\n\n`;
  }

  // Generate function argument interfaces
  for (const fn of spec.functions) {
    const interfaceName = `${capitalizeFirst(fn.name)}Args`;
    code += `/**
 * Arguments for ${capitalizeFirst(fn.name)} function\n`;
    if (fn.doc) {
      code += ` * ${fn.doc}\n`;
    }
    code += ` */\n`;
    code += `export interface ${interfaceName} ${generateFunctionArgs(fn)}\n\n`;
  }

  // Generate return type interfaces
  for (const fn of spec.functions) {
    if (fn.outputs.length > 0) {
      const returnInterfaceName = `${capitalizeFirst(fn.name)}Result`;
      code += `/**
 * Return value for ${capitalizeFirst(fn.name)} function\n`;
      code += ` */\n`;
      if (fn.outputs.length === 1) {
        code += `export type ${returnInterfaceName} = ${sorobanTypeToTs(fn.outputs[0].type)};\n\n`;
      } else {
        const fields = fn.outputs
          .map((output, i) => `  field${i}: ${sorobanTypeToTs(output.type)};`)
          .join('\n');
        code += `export interface ${returnInterfaceName} {\n${fields}\n}\n\n`;
      }
    }
  }

  // Generate client class
  code += `/**
 * Typed client for ${contractName} contract interactions
 */
export class ${contractName}Client {\n`;
  code += `  constructor(private contract: SorobanContractReturn) {}\n\n`;

  // Generate typed methods
  for (const fn of spec.functions) {
    const argsInterface = `${capitalizeFirst(fn.name)}Args`;
    const returnInterface = fn.outputs.length > 0 ? `${capitalizeFirst(fn.name)}Result` : 'void';
    const hasArgs = fn.inputs.length > 0;

    code += `  /**\n   * ${fn.doc || `Call ${fn.name} function`}\n`;
    code += `   * @param args - Function arguments\n`;
    code += `   * @returns ${returnInterface}\n   */\n`;

    code += `  async ${fn.name}(${hasArgs ? `args: ${argsInterface}` : ''}): Promise<${returnInterface}> {\n`;
    code += `    const callArgs: TypedArg[] = [\n`;

    for (const input of fn.inputs) {
      const hint = sorobanTypeToHint(input.type);
      code += `      { value: args.${input.name}, type: ${hint} },\n`;
    }

    code += `    ];\n`;
    code += `    const result = await this.contract.callFunction('${fn.name}', callArgs);\n`;
    code += `    return result as ${returnInterface};\n`;
    code += `  }\n\n`;
  }

  code += `}\n`;

  return code;
}

/**
 * Capitalize first letter of string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): BindingGeneratorOptions {
  if (args.length < 2) {
    console.error('Usage: generate-soroban-bindings <spec-file> [--output <path>] [--name <contractName>]');
    process.exit(1);
  }

  const specPath = resolve(args[0]);
  let outputPath = specPath.replace('.json', '.ts').replace('/spec', '/bindings');
  let contractName: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = resolve(args[++i]);
    } else if (args[i] === '--name' && args[i + 1]) {
      contractName = args[++i];
    }
  }

  return { specPath, outputPath, contractName };
}

/**
 * Main entry point
 */
async function main() {
  try {
    const { specPath, outputPath, contractName: customName } = parseArgs(process.argv.slice(2));

    // Read spec file
    const specContent = readFileSync(specPath, 'utf-8');
    const spec: ContractSpec = JSON.parse(specContent);

    // Validate spec
    if (!spec.functions || !Array.isArray(spec.functions)) {
      throw new Error('Invalid spec: missing functions array');
    }

    // Infer contract name from file path if not provided
    const contractName = customName || inferContractName(specPath);

    // Generate bindings
    const bindings = generateBindings(spec, contractName);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });

    // Write bindings file
    writeFileSync(outputPath, bindings, 'utf-8');

    console.log(`✓ Generated bindings for ${contractName}`);
    console.log(`  Output: ${outputPath}`);
    console.log(`  Functions: ${spec.functions.length}`);
    if (spec.errorCodes) {
      console.log(`  Error codes: ${spec.errorCodes.length}`);
    }
  } catch (error) {
    console.error('Error generating bindings:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Infer contract name from spec file path
 */
function inferContractName(specPath: string): string {
  const match = specPath.match(/\/([a-z_]+)\/spec\.json/);
  if (match) {
    return capitalizeFirst(match[1].replace(/_/g, ''));
  }
  return 'Contract';
}

main();
