/**
 * @jest-environment jsdom
 *
 * js-full UI utility components (#1208)
 */
import { expectJsFullComponentPort } from "../helpers/js-full-overlay-parity";

describe("js-full UI utility components (#1208)", () => {
  for (const name of [
    "CopyButton",
    "EmptyState",
    "ErrorBoundary",
    "LoadingBoundary",
    "Skeleton",
    "SkeletonList",
    "ThemeToggle",
  ]) {
    expectJsFullComponentPort(name);
  }
});
