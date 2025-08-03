#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const package_json_1 = __importDefault(require("../package.json"));
const scaffold_1 = require("../src/lib/scaffold");
const program = new commander_1.Command();
program
    .name('nextellar')
    .description('CLI to scaffold a Next.js + Stellar starter')
    .version(package_json_1.default.version, '-v, --version', 'output the current version')
    .argument('<project-name>', 'name of the new Nextellar project')
    .option('-t, --typescript', 'generate a TypeScript project (default)', true)
    .option('-j, --javascript', 'generate a JavaScript project')
    .option('--horizon-url <url>', 'custom Horizon endpoint')
    .option('--soroban-url <url>', 'custom Soroban RPC endpoint')
    .option('-w, --wallets <list>', 'comma-separated wallet adapters (freighter, xbull)', '')
    .option('-d, --defaults', 'skip prompts and use defaults', false);
program.action(async (projectName, options) => {
    const useTs = options.typescript && !options.javascript;
    const wallets = options.wallets ? options.wallets.split(',') : [];
    try {
        await (0, scaffold_1.scaffold)({
            appName: projectName,
            useTs,
            horizonUrl: options.horizonUrl,
            sorobanUrl: options.sorobanUrl,
            wallets,
            defaults: options.defaults,
        });
        console.log('\n✅ Your Nextellar app is ready! Run `cd ' + projectName + ' && npm run dev`');
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
});
program.parse(process.argv);
