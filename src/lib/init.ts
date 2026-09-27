import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import {
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";
import { isValidUrl } from "./validate.js";

export interface InitOptions {
  /** Project root (default: process.cwd()) */
  cwd?: string;
  /** Skip prompts entirely and write network defaults (testnet). */
  defaults?: boolean;
}

export interface InitResult {
  configPath: string;
  horizonUrl: string;
  sorobanUrl: string;
  wallets: string[];
}

const TESTNET = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanUrl: "https://soroban-testnet.stellar.org",
};
const MAINNET = {
  horizonUrl: "https://horizon.stellar.org",
  sorobanUrl: "https://soroban.stellar.org",
};

const WALLET_OPTIONS = [
  { value: "freighter", label: "Freighter", hint: "recommended" },
  { value: "albedo", label: "Albedo" },
  { value: "lobstr", label: "Lobstr" },
  { value: "xbull", label: "xBull" },
  { value: "hana", label: "Hana" },
];

/**
 * Interactively (re)writes the network and wallet settings in an existing
 * project's `.nextellar/config.json`. Unlike scaffolding, init never touches
 * template files or installs dependencies — it only edits the config a
 * project already has, so it can be re-run at any time to change network or
 * wallet choices after the fact (nester#1073... err, nextellar#1073).
 *
 * Throws if `.nextellar/config.json` does not exist, matching `upgrade`'s
 * existing "not a Nextellar project" convention. Returns null if the user
 * cancels an interactive prompt (config is left untouched in that case).
 */
export async function runInit(
  opts: InitOptions = {},
): Promise<InitResult | null> {
  const cwd = opts.cwd || process.cwd();
  const configPath = path.join(cwd, ".nextellar", "config.json");

  if (!(await fs.pathExists(configPath))) {
    throw new Error("Not a Nextellar project: missing .nextellar/config.json");
  }

  const existing = await fs.readJson(configPath).catch(() => ({}));

  let horizonUrl: string;
  let sorobanUrl: string;
  let wallets: string[];

  if (opts.defaults) {
    horizonUrl = existing.horizonUrl || TESTNET.horizonUrl;
    sorobanUrl = existing.sorobanUrl || TESTNET.sorobanUrl;
    wallets =
      Array.isArray(existing.wallets) && existing.wallets.length > 0
        ? existing.wallets
        : ["freighter"];
  } else {
    intro(pc.bold("Nextellar init"));

    const network = await select({
      message: "Which Stellar network?",
      initialValue:
        existing.horizonUrl === MAINNET.horizonUrl ? "mainnet" : "testnet",
      options: [
        {
          value: "testnet",
          label: "Testnet",
          hint: "recommended for development",
        },
        { value: "mainnet", label: "Mainnet" },
        { value: "custom", label: "Custom URLs" },
      ],
    });
    if (isCancel(network)) {
      outro(pc.dim("Cancelled"));
      return null;
    }

    if (network === "mainnet") {
      ({ horizonUrl, sorobanUrl } = MAINNET);
    } else if (network === "testnet") {
      ({ horizonUrl, sorobanUrl } = TESTNET);
    } else {
      const horizonAnswer = await text({
        message: "Horizon URL",
        initialValue: existing.horizonUrl || TESTNET.horizonUrl,
        validate: (value: string) => {
          if (!isValidUrl(value)) return "Must be a valid HTTP/HTTPS URL";
        },
      });
      if (isCancel(horizonAnswer)) {
        outro(pc.dim("Cancelled"));
        return null;
      }

      const sorobanAnswer = await text({
        message: "Soroban RPC URL",
        initialValue: existing.sorobanUrl || TESTNET.sorobanUrl,
        validate: (value: string) => {
          if (!isValidUrl(value)) return "Must be a valid HTTP/HTTPS URL";
        },
      });
      if (isCancel(sorobanAnswer)) {
        outro(pc.dim("Cancelled"));
        return null;
      }

      horizonUrl = String(horizonAnswer).trim();
      sorobanUrl = String(sorobanAnswer).trim();
    }

    const walletAnswer = await multiselect({
      message: "Which wallet adapters?",
      options: WALLET_OPTIONS,
      initialValues:
        Array.isArray(existing.wallets) && existing.wallets.length > 0
          ? existing.wallets
          : ["freighter"],
      required: false,
    });
    if (isCancel(walletAnswer)) {
      outro(pc.dim("Cancelled"));
      return null;
    }
    wallets =
      Array.isArray(walletAnswer) && walletAnswer.length > 0
        ? (walletAnswer as string[])
        : ["freighter"];

    outro(pc.dim("Updating .nextellar/config.json..."));
  }

  const updated = { ...existing, horizonUrl, sorobanUrl, wallets };
  await fs.writeJson(configPath, updated, { spaces: 2 });

  return { configPath, horizonUrl, sorobanUrl, wallets };
}
