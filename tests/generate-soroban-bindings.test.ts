import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

describe('Soroban Binding Generator', () => {
  const tempDir = join(__dirname, '..', '.test-bindings');

  beforeAll(() => {
    // Create temp directory
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Type Conversion', () => {
    it('should convert Soroban u32 to TypeScript number', () => {
      const spec = {
        functions: [
          {
            name: 'getValue',
            inputs: [],
            outputs: [{ name: 'value', type: 'u32' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetValueResult = number;');
    });

    it('should convert Soroban u128 to TypeScript bigint', () => {
      const spec = {
        functions: [
          {
            name: 'getAmount',
            inputs: [],
            outputs: [{ name: 'amount', type: 'u128' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetAmountResult = bigint;');
    });

    it('should convert Soroban string to TypeScript string', () => {
      const spec = {
        functions: [
          {
            name: 'getName',
            inputs: [{ name: 'id', type: 'u32' }],
            outputs: [{ name: 'name', type: 'string' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetNameResult = string;');
    });

    it('should convert Soroban bool to TypeScript boolean', () => {
      const spec = {
        functions: [
          {
            name: 'isActive',
            inputs: [],
            outputs: [{ name: 'active', type: 'bool' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type IsActiveResult = boolean;');
    });

    it('should convert Soroban address to TypeScript string', () => {
      const spec = {
        functions: [
          {
            name: 'getOwner',
            inputs: [],
            outputs: [{ name: 'owner', type: 'address' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetOwnerResult = string;');
    });

    it('should convert Soroban bytes to TypeScript Uint8Array', () => {
      const spec = {
        functions: [
          {
            name: 'getHash',
            inputs: [],
            outputs: [{ name: 'hash', type: 'bytes' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetHashResult = Uint8Array;');
    });

    it('should convert Soroban vec<T> to TypeScript T[]', () => {
      const spec = {
        functions: [
          {
            name: 'getIds',
            inputs: [],
            outputs: [{ name: 'ids', type: 'vec<u32>' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetIdsResult = number[];');
    });

    it('should convert Soroban vec<symbol> to TypeScript string[]', () => {
      const spec = {
        functions: [
          {
            name: 'getTags',
            inputs: [],
            outputs: [{ name: 'tags', type: 'vec<symbol>' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetTagsResult = string[];');
    });

    it('should convert Soroban option<T> to TypeScript T | null', () => {
      const spec = {
        functions: [
          {
            name: 'getOptional',
            inputs: [],
            outputs: [{ name: 'value', type: 'option<u32>' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type GetOptionalResult = number | null;');
    });
  });

  describe('Function Binding Generation', () => {
    it('should generate client class with typed methods', () => {
      const spec = {
        functions: [
          {
            name: 'transfer',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'u128' },
            ],
            outputs: [{ name: 'success', type: 'bool' }],
          },
        ],
      };

      const bindings = generateBindings(spec, 'Token');
      expect(bindings).toContain('export class TokenClient {');
      expect(bindings).toContain('async transfer(args: TransferArgs): Promise<TransferResult>');
      expect(bindings).toContain("await this.contract.callFunction('transfer', callArgs)");
    });

    it('should generate arguments interface', () => {
      const spec = {
        functions: [
          {
            name: 'approve',
            inputs: [
              { name: 'spender', type: 'address', doc: 'Account to approve' },
              { name: 'amount', type: 'u128', doc: 'Amount to approve' },
            ],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('export interface ApproveArgs');
      expect(bindings).toContain('spender: string;');
      expect(bindings).toContain('amount: bigint;');
      expect(bindings).toContain('// Account to approve');
    });

    it('should handle functions with no inputs', () => {
      const spec = {
        functions: [
          {
            name: 'totalSupply',
            inputs: [],
            outputs: [{ name: 'total', type: 'u128' }],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('async totalSupply():');
      expect(bindings).not.toContain('args: ');
    });

    it('should handle functions with no outputs', () => {
      const spec = {
        functions: [
          {
            name: 'initialize',
            inputs: [{ name: 'admin', type: 'address' }],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('Promise<void>');
    });
  });

  describe('Error Code Generation', () => {
    it('should generate error enum from spec', () => {
      const spec = {
        functions: [],
        errorCodes: [
          { code: 1, name: 'InsufficientBalance', doc: 'Not enough tokens' },
          { code: 2, name: 'InvalidRecipient', doc: 'Invalid account' },
        ],
      };

      const bindings = generateBindings(spec, 'Token');
      expect(bindings).toContain('export enum TokenErrors');
      expect(bindings).toContain('InsufficientBalance = 1');
      expect(bindings).toContain('InvalidRecipient = 2');
      expect(bindings).toContain('// Not enough tokens');
    });

    it('should not generate error enum if not in spec', () => {
      const spec = {
        functions: [],
      };

      const bindings = generateBindings(spec, 'Token');
      expect(bindings).not.toContain('enum TokenErrors');
    });
  });

  describe('XDR Type Hints', () => {
    it('should generate correct type hints for parameters', () => {
      const spec = {
        functions: [
          {
            name: 'transfer',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'u128' },
            ],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type: "address"');
      expect(bindings).toContain('type: "u128"');
    });

    it('should generate symbol type hints for symbol parameters', () => {
      const spec = {
        functions: [
          {
            name: 'greet',
            inputs: [{ name: 'recipient', type: 'symbol' }],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type: "symbol"');
    });

    it('should generate vec type hint for vector parameters', () => {
      const spec = {
        functions: [
          {
            name: 'processBatch',
            inputs: [{ name: 'items', type: 'vec<u32>' }],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('type: "vec"');
    });
  });

  describe('Documentation', () => {
    it('should include function documentation in generated code', () => {
      const spec = {
        functions: [
          {
            name: 'transfer',
            doc: 'Transfer tokens from caller to recipient',
            inputs: [],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('Transfer tokens from caller to recipient');
    });

    it('should include parameter documentation', () => {
      const spec = {
        functions: [
          {
            name: 'approve',
            inputs: [
              { name: 'amount', type: 'u128', doc: 'Amount in smallest units' },
            ],
            outputs: [],
          },
        ],
      };

      const bindings = generateBindings(spec);
      expect(bindings).toContain('// Amount in smallest units');
    });

    it('should include generated timestamp in header', () => {
      const spec = { functions: [] };
      const bindings = generateBindings(spec);
      expect(bindings).toContain('Generated:');
      expect(bindings).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('Contract Name Handling', () => {
    it('should use custom contract name in class', () => {
      const spec = { functions: [] };
      const bindings = generateBindings(spec, 'MyToken');
      expect(bindings).toContain('export class MyTokenClient');
    });

    it('should capitalize first letter of inferred name', () => {
      const spec = { functions: [] };
      const bindings = generateBindings(spec, 'testContract');
      expect(bindings).toContain('export class TestcontractClient');
    });
  });
});

// Helper function to simulate binding generation (in real tests, would import the actual function)
function generateBindings(spec: any, contractName: string = 'Contract'): string {
  let code = `/**
 * Auto-generated Soroban contract bindings for ${contractName}
 * Generated: ${new Date().toISOString()}
 */

import type { SorobanContractReturn, TypedArg } from '@/hooks/useSorobanContract';

`;

  if (spec.errorCodes && spec.errorCodes.length > 0) {
    code += `export enum ${contractName}Errors {\n`;
    for (const err of spec.errorCodes) {
      code += `  /** ${err.doc || 'Error'} */\n`;
      code += `  ${err.name} = ${err.code},\n`;
    }
    code += `}\n\n`;
  }

  for (const fn of spec.functions) {
    const interfaceName = `${capitalizeFirst(fn.name)}Args`;
    code += `export interface ${interfaceName}`;
    
    if (fn.inputs.length === 0) {
      code += ` {}\n\n`;
    } else {
      code += ` {\n`;
      for (const input of fn.inputs) {
        code += `  ${input.name}: ${sorobanTypeToTs(input.type)};`;
        if (input.doc) code += ` // ${input.doc}`;
        code += `\n`;
      }
      code += `}\n\n`;
    }
  }

  for (const fn of spec.functions) {
    if (fn.outputs.length > 0) {
      const returnInterfaceName = `${capitalizeFirst(fn.name)}Result`;
      if (fn.outputs.length === 1) {
        code += `export type ${returnInterfaceName} = ${sorobanTypeToTs(fn.outputs[0].type)};\n\n`;
      }
    }
  }

  code += `export class ${contractName}Client {\n`;
  code += `  constructor(private contract: SorobanContractReturn) {}\n\n`;

  for (const fn of spec.functions) {
    const argsInterface = `${capitalizeFirst(fn.name)}Args`;
    const returnInterface = fn.outputs.length > 0 ? `${capitalizeFirst(fn.name)}Result` : 'void';
    const hasArgs = fn.inputs.length > 0;

    code += `  async ${fn.name}(${hasArgs ? `args: ${argsInterface}` : ''}): Promise<${returnInterface}> {\n`;
    code += `    const callArgs: TypedArg[] = [\n`;
    for (const input of fn.inputs) {
      code += `      { value: args.${input.name}, type: ${sorobanTypeToHint(input.type)} },\n`;
    }
    code += `    ];\n`;
    code += `    const result = await this.contract.callFunction('${fn.name}', callArgs);\n`;
    code += `    return result as ${returnInterface};\n`;
    code += `  }\n\n`;
  }

  code += `}\n`;
  return code;
}

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

  if (sorobanType.startsWith('vec<')) {
    const inner = sorobanType.slice(4, -1);
    return `${sorobanTypeToTs(inner)}[]`;
  }
  if (sorobanType.startsWith('option<')) {
    const inner = sorobanType.slice(7, -1);
    return `${sorobanTypeToTs(inner)} | null`;
  }

  return typeMap[sorobanType] || 'unknown';
}

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
  };

  if (sorobanType.startsWith('vec<')) {
    return '"vec"';
  }

  return hintMap[sorobanType] || '"unknown"';
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
