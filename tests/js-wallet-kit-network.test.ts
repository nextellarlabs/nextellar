/**
 * @jest-environment jsdom
 *
 * JS wallet kit re-points on network change (#797).
 *
 * The js-template and js-minimal `stellar-wallet-kit.js` used to build one
 * StellarWalletsKit for the scaffold-time network and never rebuild it, so
 * after switching to mainnet the wallet still signed with the testnet kit.
 *
 * The template source contains scaffold placeholders ({{WALLETS}},
 * {{NETWORK}}) that are not valid JS until scaffold() fills them in, so each
 * test renders the file the same way scaffold does and imports a fresh copy
 * (fresh module state) from tests/__generated__.
 */
import { jest, describe, it, expect, afterAll } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES = path.resolve(__dirname, "../src/templates");
const GENERATED = path.join(__dirname, "__generated__");

type KitConfig = { network: string; modules: unknown[] };
const constructed: KitConfig[] = [];
const signCalls: Array<{ network: string; xdr: string; opts: unknown }> = [];

await jest.unstable_mockModule("@creit.tech/stellar-wallets-kit", () => {
  class StellarWalletsKit {
    config: KitConfig;
    constructor(config: KitConfig) {
      this.config = config;
      constructed.push(config);
    }
    async signTransaction(xdr: string, opts: unknown) {
      signCalls.push({ network: this.config.network, xdr, opts });
      return { signedTxXdr: `signed-on-${this.config.network}` };
    }
  }
  class Module {}
  return {
    StellarWalletsKit,
    FREIGHTER_ID: "freighter",
    FreighterModule: Module,
    AlbedoModule: Module,
    LobstrModule: Module,
    xBullModule: Module,
    HanaModule: Module,
    WalletNetwork: {
      PUBLIC: "Public Global Stellar Network ; September 2015",
      TESTNET: "Test SDF Network ; September 2015",
    },
  };
});

const PUBLIC = "Public Global Stellar Network ; September 2015";
const TESTNET = "Test SDF Network ; September 2015";

type KitModule = {
  kit: (network?: string) => unknown;
  getKit: (network?: string) => unknown;
  getKitNetwork: () => string | null;
  signTransaction: (args: {
    unsignedTransaction: string;
    address: string;
    network?: string;
    networkPassphrase?: string;
  }) => Promise<string>;
};

let counter = 0;
async function loadKit(
  template: string,
  scaffoldNetwork: "TESTNET" | "PUBLIC" = "TESTNET",
): Promise<KitModule> {
  const source = await fs.readFile(
    path.join(TEMPLATES, template, "src/lib/stellar-wallet-kit.js"),
    "utf8",
  );
  const rendered = source
    .replace("{{WALLETS}}", JSON.stringify(["freighter", "albedo"]))
    .split("{{NETWORK}}")
    .join(scaffoldNetwork);
  const file = path.join(
    GENERATED,
    `${template}-stellar-wallet-kit-${counter++}.js`,
  );
  await fs.outputFile(file, rendered);
  constructed.length = 0;
  signCalls.length = 0;
  return (await import(file)) as KitModule;
}

afterAll(async () => {
  await fs.remove(GENERATED);
});

describe.each(["js-template", "js-minimal"])(
  "%s stellar-wallet-kit network handling (#797)",
  (template) => {
    it("builds the kit for the requested network", async () => {
      const mod = await loadKit(template);
      mod.kit(TESTNET);
      expect(constructed).toHaveLength(1);
      expect(constructed[0].network).toBe(TESTNET);
      expect(mod.getKitNetwork()).toBe(TESTNET);
    });

    it("re-creates the kit when the network changes", async () => {
      const mod = await loadKit(template);
      const testnetKit = mod.kit(TESTNET);
      const mainnetKit = mod.kit(PUBLIC);

      expect(mainnetKit).not.toBe(testnetKit);
      expect(constructed.map((c) => c.network)).toEqual([TESTNET, PUBLIC]);
      expect(mod.getKitNetwork()).toBe(PUBLIC);
    });

    it("reuses the kit when the network is unchanged or omitted", async () => {
      const mod = await loadKit(template);
      const first = mod.kit(PUBLIC);
      expect(mod.kit(PUBLIC)).toBe(first);
      // kit() with no argument (e.g. disconnect) keeps the current instance.
      expect(mod.kit()).toBe(first);
      expect(constructed).toHaveLength(1);
    });

    it("defaults to the scaffold-time network when none is passed", async () => {
      const testnet = await loadKit(template, "TESTNET");
      testnet.kit();
      expect(constructed[0].network).toBe(TESTNET);

      const mainnet = await loadKit(template, "PUBLIC");
      mainnet.kit();
      expect(constructed[0].network).toBe(PUBLIC);
    });

    it("signs on mainnet after switching from testnet", async () => {
      const mod = await loadKit(template);
      mod.kit(TESTNET);

      const signed = await mod.signTransaction({
        unsignedTransaction: "AAAA",
        address: "GADDR",
        network: PUBLIC,
        networkPassphrase: PUBLIC,
      });

      expect(signed).toBe(`signed-on-${PUBLIC}`);
      expect(signCalls).toHaveLength(1);
      expect(signCalls[0].network).toBe(PUBLIC);
      expect(signCalls[0].opts).toEqual({
        address: "GADDR",
        networkPassphrase: PUBLIC,
      });
    });

    it("keeps the old signTransaction call shape working", async () => {
      const mod = await loadKit(template);
      mod.kit(TESTNET);

      await mod.signTransaction({ unsignedTransaction: "AAAA", address: "G" });

      expect(signCalls[0].network).toBe(TESTNET);
      expect(signCalls[0].opts).toEqual({ address: "G" });
    });

    it("propagates signing failures", async () => {
      const mod = await loadKit(template);
      const kitInstance = mod.kit(TESTNET) as {
        signTransaction: () => Promise<never>;
      };
      kitInstance.signTransaction = () =>
        Promise.reject(new Error("User declined"));

      await expect(
        mod.signTransaction({ unsignedTransaction: "AAAA", address: "G" }),
      ).rejects.toThrow("User declined");
    });
  },
);
