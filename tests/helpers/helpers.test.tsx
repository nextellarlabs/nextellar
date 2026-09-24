/**
 * @jest-environment jsdom
 */
import { describe, it, expect } from "@jest/globals";
import { useWallet } from "../../src/mocks/wallet-contexts-mock";
import {
  connectedWallet,
  makeHorizonPage,
  makeHorizonRecord,
  makePaymentRecord,
  PUBLIC_KEY,
  COUNTERPARTY_PUBLIC_KEY,
  render,
  renderHook,
  screen,
} from "./index";

function WalletProbe() {
  const { connected, publicKey, walletName } = useWallet();
  return (
    <div data-testid="wallet">
      {connected ? `${walletName}:${publicKey}` : "disconnected"}
    </div>
  );
}

describe("shared test helpers", () => {
  describe("renderWithProviders", () => {
    it("wraps with a disconnected wallet by default", () => {
      render(<WalletProbe />);
      expect(screen.getByTestId("wallet")).toHaveTextContent("disconnected");
    });

    it("accepts a connected wallet override", () => {
      render(<WalletProbe />, { wallet: connectedWallet() });
      expect(screen.getByTestId("wallet")).toHaveTextContent(
        `Freighter:${PUBLIC_KEY}`,
      );
    });
  });

  describe("renderHookWithProviders", () => {
    it("lets hooks read the provided wallet state", () => {
      const { result } = renderHook(() => useWallet(), {
        wallet: connectedWallet({ walletName: "Albedo" }),
      });
      expect(result.current.connected).toBe(true);
      expect(result.current.walletName).toBe("Albedo");
    });
  });

  describe("fixtures", () => {
    it("builds a received payment against PUBLIC_KEY by default", () => {
      const tx = makePaymentRecord();
      expect(tx.to).toBe(PUBLIC_KEY);
      expect(tx.from).toBe(COUNTERPARTY_PUBLIC_KEY);
      expect(tx.type).toBe("payment");
    });

    it("builds contiguous Horizon pages for pagination tests", () => {
      const page = makeHorizonPage(10, 2);
      expect(page.map((r) => r.id)).toEqual(["op-10", "op-11"]);
      expect(makeHorizonRecord(3).paging_token).toBe("pt-3");
    });
  });
});
