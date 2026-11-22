#!/usr/bin/env node
/**
 * Generates and validates docs/template-comparison.md comparing all templates.
 *
 * Covers all template combinations:
 * - minimal (TypeScript: minimal, JavaScript: js-minimal)
 * - default (TypeScript: default, JavaScript: js-template)
 * - defi (TypeScript: defi, JavaScript: js-defi)
 * - full (TypeScript: default + full overlay + contracts, JavaScript: js-template + js-full overlay + contracts)
 *
 * Usage:
 *   node scripts/generate-template-comparison.mjs         # Updates docs/template-comparison.md
 *   node scripts/generate-template-comparison.mjs --check # CI drift check (exits 1 if out of sync)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const DOC_PATH = path.join(repoRoot, 'docs', 'template-comparison.md');

function getCleanNames(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const items = new Set();
  for (const entry of entries) {
    if (entry.includes('.stories.') || entry.includes('.test.') || entry.includes('.spec.') || entry.endsWith('.d.ts')) {
      continue;
    }
    const match = entry.match(/^([A-Za-z0-9_-]+)\.(tsx|jsx|ts|js)$/);
    if (match) {
      items.add(match[1]);
    }
  }
  return Array.from(items);
}

function scanTemplate(baseDir, overlayDir = null) {
  const compDir = path.join(repoRoot, baseDir, 'src', 'components');
  const hookDir = path.join(repoRoot, baseDir, 'src', 'hooks');

  let components = getCleanNames(compDir);
  let hooks = getCleanNames(hookDir);

  if (overlayDir) {
    const overlayCompDir = path.join(repoRoot, overlayDir, 'src', 'components');
    const overlayHookDir = path.join(repoRoot, overlayDir, 'src', 'hooks');
    components = Array.from(new Set([...components, ...getCleanNames(overlayCompDir)]));
    hooks = Array.from(new Set([...hooks, ...getCleanNames(overlayHookDir)]));
  }

  components.sort();
  hooks.sort();
  return { components, hooks };
}

const TEMPLATE_SPECS = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Bare starter: wallet connection only, no extra UI',
    ts: scanTemplate('src/templates/minimal'),
    js: scanTemplate('src/templates/js-minimal'),
    withContracts: false,
    useCases: 'Lightweight dApps, custom design systems, or embedded wallet micro-frontends'
  },
  {
    id: 'default',
    name: 'Default',
    description: 'Full starter: wallet provider, network switcher, balances, payments & tx history',
    ts: scanTemplate('src/templates/default'),
    js: scanTemplate('src/templates/js-template'),
    withContracts: false,
    useCases: 'General-purpose Stellar dApps, wallet dashboards, anchor payments'
  },
  {
    id: 'defi',
    name: 'DeFi',
    description: 'DeFi starter: swaps, path payments, liquidity pool and Soroban counter',
    ts: scanTemplate('src/templates/defi'),
    js: scanTemplate('src/templates/js-defi'),
    withContracts: false,
    useCases: 'DEX integrations, automated market making, liquidity pools, token swaps'
  },
  {
    id: 'full',
    name: 'Full',
    description: 'Everything: default suite + defi demo with Soroban smart contracts pre-configured',
    ts: scanTemplate('src/templates/default', 'src/templates/full'),
    js: scanTemplate('src/templates/js-template', 'src/templates/js-full'),
    withContracts: true,
    useCases: 'End-to-end fullstack Soroban smart contract applications with frontend & backend contracts crate'
  }
];

function buildMarkdown() {
  const allComponents = Array.from(
    new Set(
      TEMPLATE_SPECS.flatMap((t) => [
        ...t.ts.components,
        ...t.js.components
      ])
    )
  ).sort();

  const allHooks = Array.from(
    new Set(
      TEMPLATE_SPECS.flatMap((t) => [
        ...t.ts.hooks,
        ...t.js.hooks
      ])
    )
  ).sort();

  let md = `# Template Comparison Matrix

This document provides a comprehensive, automatically generated feature and artifact comparison across all Nextellar starters, including TypeScript and JavaScript variants.

> **Note:** This file is generated automatically from the template sources by \`scripts/generate-template-comparison.mjs\`. Do not edit manually; CI validates drift using the \`--check\` flag.

---

## 🚀 Templates Overview

| Template | Focus / Description | TypeScript | JavaScript | Contracts Pre-configured | Primary Use Case |
| :--- | :--- | :---: | :---: | :---: | :--- |
`;

  for (const t of TEMPLATE_SPECS) {
    md += `| **\`${t.id}\`** | ${t.description} | ✅ | ✅ | ${t.withContracts ? '✅' : '❌'} | ${t.useCases} |\n`;
  }

  md += `
---

## 🧩 Components Matrix

The table below details every React component included across each template. \`TS\` indicates availability in TypeScript (\`.tsx\`), and \`JS\` indicates availability in JavaScript (\`.jsx\`).

| Component | \`minimal\` (TS / JS) | \`default\` (TS / JS) | \`defi\` (TS / JS) | \`full\` (TS / JS) |
| :--- | :---: | :---: | :---: | :---: |
`;

  for (const comp of allComponents) {
    const row = TEMPLATE_SPECS.map((t) => {
      const hasTs = t.ts.components.includes(comp);
      const hasJs = t.js.components.includes(comp);
      if (hasTs && hasJs) return '✅ / ✅';
      if (hasTs && !hasJs) return '✅ / ❌';
      if (!hasTs && hasJs) return '❌ / ✅';
      return '❌ / ❌';
    });
    md += `| \`${comp}\` | ${row.join(' | ')} |\n`;
  }

  md += `
---

## 🪝 Hooks Matrix

The table below lists every custom React hook available in each template's \`src/hooks/\` directory.

| Hook | \`minimal\` (TS / JS) | \`default\` (TS / JS) | \`defi\` (TS / JS) | \`full\` (TS / JS) |
| :--- | :---: | :---: | :---: | :---: |
`;

  for (const hook of allHooks) {
    const row = TEMPLATE_SPECS.map((t) => {
      const hasTs = t.ts.hooks.includes(hook);
      const hasJs = t.js.hooks.includes(hook);
      if (hasTs && hasJs) return '✅ / ✅';
      if (hasTs && !hasJs) return '✅ / ❌';
      if (!hasTs && hasJs) return '❌ / ✅';
      return '❌ / ❌';
    });
    md += `| \`${hook}\` | ${row.join(' | ')} |\n`;
  }

  md += `
---

## 🛠️ Feature Comparison

| Capability | \`minimal\` | \`default\` | \`defi\` | \`full\` |
| :--- | :---: | :---: | :---: | :---: |
| **Stellar Wallets Kit (Freighter, Albedo, xBull)** | ✅ | ✅ | ✅ | ✅ |
| **Network Switcher (Testnet / Mainnet / Custom)** | ✅ | ✅ | ✅ | ✅ |
| **Horizon Balance & Trustlines** | ✅ | ✅ | ✅ | ✅ |
| **Transaction History Feed** | ✅ | ✅ | ✅ | ✅ |
| **Send & Receive Payment Flows** | ✅ | ✅ | ✅ | ✅ |
| **DeFi Token Swaps & Path Payments** | ❌ | ❌ | ✅ | ❌ |
| **SEP-24 Interactive Anchor Webview** | ❌ | ✅ | ✅ | ✅ |
| **SEP-30 Key Recovery** | ❌ | ✅ | ✅ | ✅ |
| **SEP-38 Anchor Quotes** | ❌ | ✅ | ✅ | ✅ |
| **Soroban Smart Contracts Overlay (\`contracts/\`)** | Opt-in (\`--with-contracts\`) | Opt-in (\`--with-contracts\`) | Opt-in (\`--with-contracts\`) | **Included by Default** |
| **Soroban Counter Demo Component** | ❌ | ❌ | ✅ | ✅ |
| **Tailwind CSS & Dark Theme Support** | ✅ | ✅ | ✅ | ✅ |
| **Storybook Stories Included** | ✅ | ✅ | ✅ | ✅ |

---

## 🔄 Keeping This Document Current

To update this document after modifying templates, run:

\`\`\`bash
node scripts/generate-template-comparison.mjs
\`\`\`

To verify in CI that the documentation is in sync with the codebase:

\`\`\`bash
node scripts/generate-template-comparison.mjs --check
\`\`\`
<!-- Generated by scripts/generate-template-comparison.mjs. Do not edit manually. -->
`;

  return md;
}

const isCheck = process.argv.includes('--check');
const generatedMd = buildMarkdown();

if (isCheck) {
  if (!fs.existsSync(DOC_PATH)) {
    console.error(`[DRIFT CHECK FAILED] ${DOC_PATH} does not exist. Run "node scripts/generate-template-comparison.mjs" to create it.`);
    process.exit(1);
  }
  const existingMd = fs.readFileSync(DOC_PATH, 'utf-8');
  if (existingMd.trim() !== generatedMd.trim()) {
    console.error(`[DRIFT CHECK FAILED] docs/template-comparison.md is out of date with current template definitions.`);
    console.error(`Run "node scripts/generate-template-comparison.mjs" to regenerate.`);
    process.exit(1);
  }
  console.log('✓ docs/template-comparison.md is in sync with template sources.');
  process.exit(0);
} else {
  fs.writeFileSync(DOC_PATH, generatedMd, 'utf-8');
  console.log(`✓ Successfully updated ${DOC_PATH}`);
}
