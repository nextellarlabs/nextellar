/** @type { import('@storybook/react-vite').StorybookConfig } */
const path = require("path");
const { fileURLToPath } = require("url");

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  stories: [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@storybook/addon-links",
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
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
        },
      },
    });
  },
};

export default config;
