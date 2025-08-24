#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json' with { type: "json" };
import { scaffold } from '../src/lib/scaffold.js';

const program = new Command();


program
  .name('nextellar')
  .description('CLI to scaffold a Next.js + Stellar starter')
  .version(pkg.version, '-v, --version', 'output the current version')
  .argument('<project-name>', 'name of the new Nextellar project')
  .option('-t, --typescript', 'generate a TypeScript project (default)', true)
  .option('-j, --javascript', 'generate a JavaScript project')
  .option('--horizon-url <url>', 'custom Horizon endpoint')
  .option('--soroban-url <url>', 'custom Soroban RPC endpoint')
  .option('-w, --wallets <list>', 'comma-separated wallet adapters (freighter, xbull)', '')
  .option('-d, --defaults', 'skip prompts and use defaults', false)
  .option('--skip-install', 'skip dependency installation after scaffolding', false)
  .option('--package-manager <manager>', 'choose package manager (npm, yarn, pnpm)')
  .option('--install-timeout <ms>', 'installation timeout in milliseconds', '1200000');



  program.action(async (projectName, options) => {
  const useTs = options.typescript && !options.javascript;
  const wallets = options.wallets ? options.wallets.split(',') : [];
  try {
    await scaffold({
      appName: projectName,
      useTs,
      horizonUrl: options.horizonUrl,
      sorobanUrl: options.sorobanUrl,
      wallets,
      defaults: options.defaults,
      skipInstall: options.skipInstall,
      packageManager: options.packageManager,
      installTimeout: parseInt(options.installTimeout),
    });
    
    if (options.skipInstall) {
      console.log('\n✅ Your Nextellar app is ready!');
      console.log(`   cd ${projectName}`);
      console.log('   npm install');
      console.log('   npm run dev');
    } else {
      console.log('\n✅ Your Nextellar app is ready! Run:');
      console.log(`   cd ${projectName}`);
      console.log('   npm run dev');
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
});


program.parse(process.argv);
