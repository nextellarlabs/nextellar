/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ReceiveForm from "../../src/templates/default/src/components/ReceiveForm";
// SendForm/ReceiveForm import "../contexts", which jest maps to this mock.
import { WalletContext } from "../../src/mocks/wallet-contexts-mock";

const ADDRESS = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const ISSUER = "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2";

function renderWithWallet(ui: ReactNode, wallet: Record<string, unknown> = {}) {
  return render(
    <WalletContext.Provider
      value={{ connected: true, publicKey: ADDRESS, ...wallet }}
    >
      {ui}
    </WalletContext.Provider>,
  );
}

describe("ReceiveForm (#662)", () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("disconnected", () => {
    it("shows an empty state with no address, QR or copy button", () => {
      renderWithWallet(<ReceiveForm />, {
        connected: false,
        publicKey: undefined,
      });

      expect(screen.getByTestId("receive-form-empty")).toHaveTextContent(
        "Connect your wallet to see your receive address.",
      );
      expect(screen.queryByTestId("receive-form-qr")).not.toBeInTheDocument();
      expect(screen.queryByTestId("receive-form-copy")).not.toBeInTheDocument();
    });

    it("explains when a wallet is connected but returned no key", () => {
      renderWithWallet(<ReceiveForm />, {
        connected: true,
        publicKey: undefined,
      });
      expect(screen.getByTestId("receive-form-empty")).toHaveTextContent(
        "No address available.",
      );
    });

    it("still renders an explicit address prop", () => {
      renderWithWallet(<ReceiveForm address={ADDRESS} />, {
        connected: false,
        publicKey: undefined,
      });
      expect(screen.getByTestId("receive-form")).toBeInTheDocument();
    });
  });

  describe("connected", () => {
    it("shows the address truncated in monospace with a full-key reveal", () => {
      renderWithWallet(<ReceiveForm />);

      const address = screen.getByTestId("receive-form-address");
      expect(address).toHaveTextContent(
        `${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-6)}`,
      );
      expect(address).toHaveAttribute("title", ADDRESS);
      expect(address.className).toContain("font-mono");

      const reveal = screen.getByRole("button", { name: "Show full address" });
      expect(reveal).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(reveal);
      expect(address).toHaveTextContent(ADDRESS);
      expect(
        screen.getByRole("button", { name: "Hide full address" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("renders the address as an inline SVG QR code", () => {
      renderWithWallet(<ReceiveForm qrSize={180} />);

      const svg = screen.getByRole("img", {
        name: `QR code for Stellar address ${ADDRESS}`,
      });
      // Version 4 symbol (33 modules) plus a 2-module quiet zone on each side.
      expect(svg).toHaveAttribute("viewBox", "0 0 37 37");
      expect(svg).toHaveAttribute("width", "180");
      expect(svg.querySelector("path")?.getAttribute("d")).toMatch(
        /^M\d+,\d+h1v1h-1z/,
      );
    });

    it("copies the full address and shows Copied! for about 2 seconds", async () => {
      jest.useFakeTimers();
      renderWithWallet(<ReceiveForm />);

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy address to clipboard" }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(ADDRESS);
      expect(screen.getByTestId("receive-form-copied")).toHaveTextContent(
        "Copied!",
      );
      expect(
        screen.getByRole("button", { name: "Address copied" }),
      ).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1999);
      });
      expect(screen.getByTestId("receive-form-copied")).toHaveTextContent(
        "Copied!",
      );

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByTestId("receive-form-copied")).toHaveTextContent("");
    });

    it("does not show Copied! when the clipboard is unavailable", async () => {
      writeText.mockRejectedValue(new Error("NotAllowedError"));
      renderWithWallet(<ReceiveForm />);

      await act(async () => {
        fireEvent.click(screen.getByTestId("receive-form-copy"));
      });

      expect(screen.getByTestId("receive-form-copied")).toHaveTextContent("");
    });
  });

  describe("amount (SEP-7 payment request)", () => {
    it("encodes a web+stellar:pay URI in the QR and the copy button", async () => {
      renderWithWallet(<ReceiveForm amount="25" />);

      expect(
        screen.getByRole("img", {
          name: `QR code for a SEP-7 payment request to ${ADDRESS}`,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("receive-form-request-summary"),
      ).toHaveTextContent("Requesting 25 XLM");

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: "Copy payment request to clipboard",
          }),
        );
      });
      expect(writeText).toHaveBeenCalledWith(
        `web+stellar:pay?destination=${ADDRESS}&amount=25`,
      );
    });

    it("includes the asset for a non-native request", async () => {
      renderWithWallet(
        <ReceiveForm amount="10" asset={{ code: "USDC", issuer: ISSUER }} />,
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId("receive-form-copy"));
      });
      const uri = new URL(
        writeText.mock.calls[0][0].replace("web+stellar:", "https://x/"),
      );
      expect(uri.searchParams.get("amount")).toBe("10");
      expect(uri.searchParams.get("asset_code")).toBe("USDC");
      expect(uri.searchParams.get("asset_issuer")).toBe(ISSUER);
    });
  });

  it("downloads the QR as an SVG file", () => {
    renderWithWallet(<ReceiveForm />);
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    let anchor: HTMLAnchorElement | null = null;
    const append = jest.spyOn(document.body, "appendChild");

    fireEvent.click(
      screen.getByRole("button", { name: "Download QR code as SVG" }),
    );

    anchor = append.mock.calls
      .map(([node]) => node)
      .find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement;
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe(`stellar-address-${ADDRESS.slice(0, 8)}.svg`);
    expect(anchor.href).toMatch(/^data:image\/svg\+xml/);
    click.mockRestore();
    append.mockRestore();
  });
});
