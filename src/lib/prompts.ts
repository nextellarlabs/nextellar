import path from "path";
import pc from "picocolors";
import {
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  text,
} from "@clack/prompts";
import { detectPackageManager } from "./install.js";

export interface PromptResult {
  projectName: string;
  horizonUrl?: string;
  sorobanUrl?: string;
  wallets?: string[];
  packageManager?: "npm" | "yarn" | "pnpm";
  skipInstall?: boolean;
}

export interface PromptContext {
  initialProjectName: string;
  cwd: string;
  defaultWallets: string[];
  packageManagerFromFlag?: "npm" | "yarn" | "pnpm";
  networkFlagProvided: boolean;
  walletsFlagProvided: boolean;
  packageManagerFlagProvided: boolean;
  skipInstallFlagProvided: boolean;
}

export async function runInteractivePrompts(
  ctx: PromptContext
): Promise<PromptResult | null> {
  intro(pc.bold("Nextellar"));

  const nameAnswer = await text({
    message: "Project name",
    initialValue: ctx.initialProjectName,
    validate: (value: string) => {
      if (!value || value.trim().length === 0) return "Project name is required";
    },
  });

  if (isCancel(nameAnswer)) {
    outro(pc.dim("Cancelled"));
    return null;
  }

  
  const projectName = String(nameAnswer).trim();

  let horizonUrl: string | undefined;
  let sorobanUrl: string | undefined;
  if (!ctx.networkFlagProvided) {
    const network = await select({
      message: "Which Stellar network?",
      initialValue: "testnet",
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
      horizonUrl = "https://horizon.stellar.org";
      sorobanUrl = "https://soroban.stellar.org";
    } else if (network === "testnet") {
      horizonUrl = "https://horizon-testnet.stellar.org";
      sorobanUrl = "https://soroban-testnet.stellar.org";
    } else {
      const horizonAnswer = await text({
        message: "Horizon URL",
        initialValue: "https://horizon-testnet.stellar.org",
        validate: (value: string) => {
          if (!value || value.trim().length === 0) return "Horizon URL is required";
        },
      });

      if (isCancel(horizonAnswer)) {
        outro(pc.dim("Cancelled"));
        return null;
      }

      const sorobanAnswer = await text({
        message: "Soroban RPC URL",
        initialValue: "https://soroban-testnet.stellar.org",
        validate: (value: string) => {
          if (!value || value.trim().length === 0) return "Soroban URL is required";
        },
      });

      if (isCancel(sorobanAnswer)) {
        outro(pc.dim("Cancelled"));
        return null;
      }

      horizonUrl = String(horizonAnswer).trim();
      sorobanUrl = String(sorobanAnswer).trim();
    }
  }

  let wallets: string[] | undefined;
  if (!ctx.walletsFlagProvided) {
    const walletAnswer = await multiselect({
      message: "Which wallet adapters?",
      options: [
        { value: "freighter", label: "Freighter", hint: "recommended" },
        { value: "albedo", label: "Albedo" },
        { value: "lobstr", label: "Lobstr" },
        { value: "xbull", label: "xBull" },
        { value: "hana", label: "Hana" },
      ],
      initialValues: ctx.defaultWallets,
      required: false,
    });

    if (isCancel(walletAnswer)) {
      outro(pc.dim("Cancelled"));
      return null;
    }

    wallets =
      Array.isArray(walletAnswer) && walletAnswer.length > 0
        ? (walletAnswer as string[])
        : ctx.defaultWallets;
  }

  let packageManager: "npm" | "yarn" | "pnpm" | undefined;
  if (!ctx.packageManagerFlagProvided) {
    const detected = detectPackageManager(
      path.join(ctx.cwd, projectName),
      ctx.packageManagerFromFlag
    );

    const pm = await select({
      message: "Package manager",
      initialValue: detected,
      options: [
        { value: "npm", label: "npm", hint: detected === "npm" ? "detected" : undefined },
        { value: "yarn", label: "yarn", hint: detected === "yarn" ? "detected" : undefined },
        { value: "pnpm", label: "pnpm", hint: detected === "pnpm" ? "detected" : undefined },
      ],
    });

    if (isCancel(pm)) {
      outro(pc.dim("Cancelled"));
      return null;
    }

    packageManager = pm as "npm" | "yarn" | "pnpm";
  }

  let skipInstall: boolean | undefined;
  if (!ctx.skipInstallFlagProvided) {
    const install = await confirm({
      message: "Install dependencies?",
      initialValue: true,
    });

    if (isCancel(install)) {
      outro(pc.dim("Cancelled"));
      return null;
    }

    skipInstall = install === false;
  }

  outro(pc.dim(`Creating ${projectName}...`));

  return {
    projectName,
    horizonUrl,
    sorobanUrl,
    wallets,
    packageManager,
    skipInstall,
  };
}
