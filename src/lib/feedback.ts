import pc from "picocolors";

/**
 * Consistent error/warning formatters for the whole CLI.
 *
 * Every failure path reports through these so that users see a uniform
 * `❌ <message>` (stderr) for errors and `⚠ <message>` (stderr) for warnings,
 * regardless of which command surfaced the problem. Keeping the formatting in
 * one place is what makes the audit of "consistent error formatting" tractable
 * (#consistent-errors).
 */
export function printError(message: string): void {
  console.error(pc.red(`❌ ${message}`));
}

export function printWarning(message: string): void {
  // Warnings go to stderr so they stay visible even when stdout is piped.
  console.error(pc.yellow(`⚠ ${message}`));
}

export const NEXTELLAR_LOGO = [
  "",
  "  ███╗   ██╗███████╗██╗  ██╗████████╗███████╗██╗     ██╗      █████╗ ██████╗ ",
  "  ████╗  ██║██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝██║     ██║     ██╔══██╗██╔══██╗",
  "  ██╔██╗ ██║█████╗   ╚███╔╝    ██║   █████╗  ██║     ██║     ███████║██████╔╝",
  "  ██║╚██╗██║██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║     ██║     ██╔══██║██╔══██╗",
  "  ██║ ╚████║███████╗██╔╝ ██╗   ██║   ███████╗███████╗███████╗██║  ██║██║  ██║",
  "  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝",
  "",
].join("\n");

// Figma brand color is approximately magenta/indigo in ANSI
const brandColor = (text: string) => pc.magenta(text);

export async function displaySuccess(
  appName: string,
  packageManager: string = "npm",
  skipInstall: boolean = false
): Promise<void> {
  if (!process.stdout.isTTY || process.env.CI) {
    console.log(`\n${pc.green("✔")} Nextellar scaffold complete!`);
    console.log(`\n${pc.bold("Next steps:")}`);
    console.log(`  cd ${appName}`);
    if (skipInstall) {
      console.log(`  ${packageManager} install`);
    }
    console.log(`  ${packageManager} run dev`);
    console.log(`\n${pc.bold("Available commands:")}`);
    console.log(`  ${packageManager} run dev        Start development server`);
    console.log(`  ${packageManager} run build      Build for production`);
    console.log(`  ${packageManager} run start      Start production server`);
    console.log(`  ${packageManager} run lint        Run linter`);
    console.log(`\n${pc.bold("Deployment:")}`);
    console.log(`  npx vercel              Deploy to Vercel`);
    console.log(`  nextellar deploy        Deploy to Nextellar Cloud (coming soon)\n`);
    return;
  }

  console.log(
    `\n  ${pc.green("✔")} ${pc.bold("Project scaffolded successfully!")}`
  );
  console.log(
    `\n  ${pc.dim("──────────────────────────────────────────────────")}`
  );
  console.log(`  ${pc.bold("Next steps:")}`);
  console.log(`  ${brandColor("1.")} cd ${pc.cyan(appName)}`);
  let step = 2;
  if (skipInstall) {
    console.log(`  ${brandColor(`${step++}.`)} ${packageManager} install`);
  }
  console.log(`  ${brandColor(`${step++}.`)} ${packageManager} run dev`);
  console.log(
    `  ${pc.dim("──────────────────────────────────────────────────")}\n`
  );

  console.log(`  ${pc.bold("Available commands:")}`);
  console.log(`  ${pc.cyan(`${packageManager} run dev`)}        Start development server`);
  console.log(`  ${pc.cyan(`${packageManager} run build`)}      Build for production`);
  console.log(`  ${pc.cyan(`${packageManager} run start`)}      Start production server`);
  console.log(`  ${pc.cyan(`${packageManager} run lint`)}        Run linter`);
  console.log(
    `  ${pc.dim("──────────────────────────────────────────────────")}\n`
  );

  console.log(`  ${pc.magenta("✦")} ${pc.italic("Deployment:")}`);
  console.log(`  ${pc.dim("npx vercel")}              Deploy to Vercel`);
  console.log(`  ${pc.dim("nextellar deploy")}        Deploy to Nextellar Cloud (coming soon)`);
  console.log(`  ${pc.dim("Check out nextellar.dev for more guides.")}\n`);
}