import type { StorybookConfig } from "@storybook/react-vite";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
    "@storybook/addon-themes",
    "@storybook/addon-a11y",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite");
    return mergeConfig(config, {
      resolve: {
        alias: {
          // Storybook-only mock so BalanceDisplay stories render balances
          // without performing a live Horizon RPC call.
          "../hooks/useStellarBalances": path.resolve(
            dirname,
            "./mocks/useStellarBalances.ts"
          ),
          // Storybook-only mock so ContractCallForm stories simulate and
          // build contract calls without reaching a live Soroban RPC.
          "../hooks/useSorobanContract": path.resolve(
            dirname,
            "./mocks/useSorobanContract.ts"
          ),
        },
      },
    });
  },
};

export default config;
