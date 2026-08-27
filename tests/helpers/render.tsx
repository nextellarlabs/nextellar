import { createElement, type ReactElement, type ReactNode } from "react";
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { ThemeContext } from "../../src/templates/default/src/contexts/ThemeProvider";
import {
  WalletConfigContext,
  WalletContext,
  type MockWalletConfig,
  type MockWalletState,
} from "../../src/mocks/wallet-contexts-mock";
import {
  createThemeState,
  createWalletState,
  type ThemeState,
} from "./fixtures";

type WrapperComponent = (props: { children: ReactNode }) => ReactElement | null;

export type ProviderOptions = {
  wallet?: Partial<MockWalletState>;
  walletConfig?: MockWalletConfig;
  theme?: Partial<ThemeState>;
};

export type RenderWithProvidersOptions = Omit<RenderOptions, "wrapper"> &
  ProviderOptions & {
    wrapper?: WrapperComponent;
  };

export type RenderHookWithProvidersOptions<TProps> = Omit<
  RenderHookOptions<TProps>,
  "wrapper"
> &
  ProviderOptions & {
    wrapper?: WrapperComponent;
  };

function createProviders({
  wallet,
  walletConfig,
  theme,
  inner,
}: ProviderOptions & { inner?: WrapperComponent }) {
  const walletValue = createWalletState(wallet);
  const themeValue = createThemeState(theme);

  return function Providers({ children }: { children: ReactNode }) {
    const content = inner ? createElement(inner, null, children) : children;
    return createElement(
      ThemeContext.Provider,
      { value: themeValue },
      createElement(
        WalletConfigContext.Provider,
        { value: walletConfig },
        createElement(WalletContext.Provider, { value: walletValue }, content),
      ),
    );
  };
}

/**
 * Testing Library `render` wrapped with theme + wallet (+ optional config)
 * providers. Pass `wallet` / `theme` / `walletConfig` instead of building a
 * one-off wrapper in each test file.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { wallet, walletConfig, theme, wrapper, ...renderOptions } = options;
  const Providers = createProviders({
    wallet,
    walletConfig,
    theme,
    inner: wrapper,
  });
  return rtlRender(ui, { wrapper: Providers, ...renderOptions });
}

/**
 * Testing Library `renderHook` with the same provider tree as
 * `renderWithProviders`. `initialProps` and other hook options pass through.
 */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options: RenderHookWithProvidersOptions<TProps> = {},
): RenderHookResult<TResult, TProps> {
  const { wallet, walletConfig, theme, wrapper, ...hookOptions } = options;
  const Providers = createProviders({
    wallet,
    walletConfig,
    theme,
    inner: wrapper,
  });
  return rtlRenderHook(hook, { wrapper: Providers, ...hookOptions });
}

/** Unwrapped Testing Library render, for asserting provider-required errors. */
export { rtlRender, rtlRenderHook };
