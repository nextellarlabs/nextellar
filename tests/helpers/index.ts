/**
 * Shared test helpers for component and hook tests.
 *
 * Import from `../helpers` (or `./helpers`) instead of
 * `@testing-library/react` so every test gets the same provider tree and
 * fixtures:
 *
 * ```ts
 * import { render, screen, connectedWallet, PUBLIC_KEY } from "../helpers";
 *
 * render(<WalletConnectButton />, { wallet: connectedWallet() });
 * ```
 *
 * `render` / `renderHook` wrap the tree with theme and wallet contexts.
 * Use `rtlRender` / `rtlRenderHook` when you need the unwrapped originals
 * (e.g. asserting that a hook throws outside a provider).
 */
export {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

export {
  renderWithProviders,
  renderHookWithProviders,
  renderWithProviders as render,
  renderHookWithProviders as renderHook,
  rtlRender,
  rtlRenderHook,
} from "./render";

export type {
  ProviderOptions,
  RenderWithProvidersOptions,
  RenderHookWithProvidersOptions,
} from "./render";

export * from "./fixtures";
export { flush, silenceConsole } from "./console";
