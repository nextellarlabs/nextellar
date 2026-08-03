/**
 * Simple syntax check for TypeScript files in routes-d
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const files = [
  join(__dirname, 'middleware', 'deprecation.ts'),
  join(__dirname, 'tests', 'unit', 'deprecation.test.ts'),
  join(__dirname, 'tests', 'integration', 'deprecation.integration.test.ts'),
  join(__dirname, 'routes', 'example.deprecated.ts'),
  join(__dirname, 'lib', 'exampleApp.ts'),
];

console.log('Checking TypeScript files syntax...\n');

let allGood = true;

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf8');
    
    // Basic syntax checks
    const balanced = {
      braces: (content.match(/{/g) || []).length === (content.match(/}/g) || []).length,
      parens: (content.match(/\(/g) || []).length === (content.match(/\)/g) || []).length,
      brackets: (content.match(/\[/g) || []).length === (content.match(/\]/g) || []).length,
    };
    
    if (!balanced.braces || !balanced.parens || !balanced.brackets) {
      console.error(`❌ ${file}: Unbalanced delimiters`);
      allGood = false;
    } else {
      console.log(`✅ ${file}`);
    }
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
    allGood = false;
  }
}

console.log(allGood ? '\n✅ All files syntax check passed!' : '\n❌ Some files have syntax issues');
process.exit(allGood ? 0 : 1);
