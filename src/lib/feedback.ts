import pc from "picocolors";

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

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
    console.log(`  ${packageManager} run dev\n`);
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

  console.log(`  ${pc.magenta("✦")} ${pc.italic("Deployment:")}`);
  console.log(`  ${pc.dim("Check out nextellar.dev for more guides.")}\n`);
}

export function startProgress() {
  if (!process.stdout.isTTY || process.env.CI) return null;

  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(
      `\r  ${brandColor(frames[i % frames.length])} ${pc.dim(
        "Developing something Stellar..."
      )}`
    );
    i++;
  }, 80);

  return () => {
    clearInterval(timer);
    process.stdout.write("\r\x1b[K");
  };
}
