/**
 * @jest-environment jsdom
 *
 * js-full wallet/account components (#1206)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectJsFullComponentPort } from "../helpers/js-full-overlay-parity";

const TEMPLATES = join(process.cwd(), "src", "templates");

describe("js-full wallet/account components (#1206)", () => {
  for (const name of [
    "WalletConnectButton",
    "AccountSwitcher",
    "NetworkSwitcher",
    "NetworkMismatchBanner",
  ]) {
    expectJsFullComponentPort(name);
  }

  it("wires the scaffolded page the same way the default page does", () => {
    const page = readFileSync(
      join(TEMPLATES, "js-full", "src", "app", "page.jsx"),
      "utf8",
    );
    const defaultPage = readFileSync(
      join(TEMPLATES, "default", "src", "app", "page.tsx"),
      "utf8",
    );

    for (const source of [page, defaultPage]) {
      expect(source).toContain(
        "import WalletConnectButton from '../components/WalletConnectButton';",
      );
      expect(source).toContain(
        "import NetworkSwitcher from '../components/NetworkSwitcher';",
      );
      expect(source).toContain("<NetworkSwitcher />");
    }
    expect(page).toContain("<WalletConnectButton theme={theme}/>");
  });
});
