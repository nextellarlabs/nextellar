import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import pc from "picocolors";
import { checkStellarCli } from "./doctor.js";

export interface ContractsConfig {
  network: string;
  identity: string;
}

/**
 * Reads network and identity defaults from .nextellar/config.json if present.
 */
export async function readContractsConfig(cwd: string): Promise<ContractsConfig> {
  const configPath = path.join(cwd, ".nextellar", "config.json");
  let network = "testnet";
  let identity = "alice";

  if (await fs.pathExists(configPath)) {
    try {
      const config = await fs.readJson(configPath);
      if (config.network) {
        network = String(config.network).toLowerCase();
      } else if (config.horizonUrl) {
        network = String(config.horizonUrl).includes("public") ? "public" : "testnet";
      }
      if (config.identity) {
        identity = String(config.identity);
      }
    } catch {
      // Use defaults if config reading fails
    }
  }

  return { network, identity };
}

/**
 * Asserts that the Stellar CLI is installed and available, reusing doctor diagnostics.
 */
export async function assertStellarCli(): Promise<void> {
  const check = await checkStellarCli();
  if (!check.ok) {
    throw new Error(
      `Stellar CLI is not installed (needed for contract development). ${check.fix || "Install: cargo install stellar-cli"}`,
    );
  }
}

export interface ContractsBuildOptions {
  cwd?: string;
  manifestPath?: string;
}

export async function runContractsBuild(
  options: ContractsBuildOptions = {},
): Promise<{ success: boolean }> {
  await assertStellarCli();
  const cwd = options.cwd || process.cwd();
  const contractsDir = (await fs.pathExists(path.join(cwd, "contracts")))
    ? path.join(cwd, "contracts")
    : cwd;

  console.log(pc.cyan("Building Soroban contracts with Stellar CLI..."));
  await execa("stellar", ["contract", "build"], {
    cwd: contractsDir,
    stdio: "inherit",
  });

  console.log(pc.green("✔️  Contracts built successfully."));
  return { success: true };
}

export interface ContractsDeployOptions {
  cwd?: string;
  wasm?: string;
  network?: string;
  source?: string;
  envVar?: string;
}

export async function runContractsDeploy(
  options: ContractsDeployOptions = {},
): Promise<{ contractId: string; envPath: string }> {
  await assertStellarCli();
  const cwd = options.cwd || process.cwd();
  const defaults = await readContractsConfig(cwd);

  const network = options.network || defaults.network;
  const source = options.source || defaults.identity;

  let wasmPath = options.wasm;
  if (!wasmPath) {
    // Look for built wasm in release directory
    const candidates = [
      path.join(cwd, "contracts", "target", "wasm32-unknown-unknown", "release"),
      path.join(cwd, "target", "wasm32-unknown-unknown", "release"),
    ];

    for (const dir of candidates) {
      if (await fs.pathExists(dir)) {
        const files = await fs.readdir(dir);
        const wasmFile = files.find(
          (f) => f.endsWith(".wasm") && !f.includes(".d.wasm"),
        );
        if (wasmFile) {
          wasmPath = path.join(dir, wasmFile);
          break;
        }
      }
    }
  }

  if (!wasmPath || !(await fs.pathExists(wasmPath))) {
    throw new Error(
      `WASM contract file not found. Specify --wasm or run 'nextellar contracts build' first.`,
    );
  }

  console.log(
    pc.cyan(
      `Deploying contract (${path.basename(wasmPath)}) to ${network} using identity ${source}...`,
    ),
  );

  const { stdout } = await execa("stellar", [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source",
    source,
    "--network",
    network,
  ]);

  const output = stdout.trim();
  const match = output.match(/\b(C[A-Z0-9]{55})\b/);
  const contractId = match ? match[1] : output;

  if (!contractId || !contractId.startsWith("C")) {
    throw new Error(`Failed to parse deployed contract ID from output: ${output}`);
  }

  // Update .env.local
  const envPath = path.join(cwd, ".env.local");
  let envContent = "";
  if (await fs.pathExists(envPath)) {
    envContent = await fs.readFile(envPath, "utf8");
  }

  const varName = options.envVar || "NEXT_PUBLIC_CONTRACT_ID";
  const regex = new RegExp(`^${varName}=.*$`, "m");
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${varName}=${contractId}`);
  } else {
    envContent = `${envContent ? envContent.trimEnd() + "\n" : ""}${varName}=${contractId}\n`;
  }

  await fs.writeFile(envPath, envContent, "utf8");

  console.log(pc.green(`✔️  Deployed contract ID: ${contractId}`));
  console.log(pc.green(`✔️  Updated ${envPath} with ${varName}=${contractId}`));

  return { contractId, envPath };
}

export interface ContractsInvokeOptions {
  cwd?: string;
  id: string;
  fn: string;
  args?: string[];
  network?: string;
  source?: string;
}

export async function runContractsInvoke(
  options: ContractsInvokeOptions,
): Promise<{ result: string }> {
  await assertStellarCli();
  const cwd = options.cwd || process.cwd();
  const defaults = await readContractsConfig(cwd);

  const network = options.network || defaults.network;
  const source = options.source || defaults.identity;

  if (!options.id) {
    throw new Error("Contract ID is required (--id <contract-id>).");
  }
  if (!options.fn) {
    throw new Error("Function name is required (--fn <function-name>).");
  }

  const cmdArgs = [
    "contract",
    "invoke",
    "--id",
    options.id,
    "--source",
    source,
    "--network",
    network,
    "--",
    options.fn,
    ...(options.args || []),
  ];

  console.log(
    pc.cyan(
      `Invoking ${options.fn} on contract ${options.id} on ${network} as ${source}...`,
    ),
  );

  const { stdout } = await execa("stellar", cmdArgs);
  console.log(stdout);

  return { result: stdout };
}
