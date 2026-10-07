/**
 * @jest-environment jsdom
 *
 * WalletConnectButton Component Tests
 *
 * Renders the real component rather than asserting against hand-written
 * mock objects, so the button's actual wiring to the wallet context is
 * what is under test.
 *
 * Covers:
 * - Disconnected state and the connect action
 * - Connected state and the disconnect action
 * - In-flight labelling and the disabled guard
 * - Failure handling for both actions
 * - Theme styling and the AccountSwitcher slot
 * - Manual balance-refresh affordance (#1069)
 * - Multi-wallet selection modal (#1132)
 */
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import React from "react";

// ── Mock the wallet contexts module ───────────────────────────────────────────
// WalletConnectButton imports useWallet from '../contexts', which
// jest.config.mjs maps to src/mocks/wallet-contexts-mock.
jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

// WalletConnectButton also wires the refresh affordance directly to
// useStellarBalances (real hook, not the wallet context), so it's mocked the
// same way BalanceDisplay's tests mock it.
jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

// ── Multi-wallet selection (#1132) ────────────────────────────────────────────
// The selection modal is owned by the wallet kit's `openModal`, which the real
// WalletProvider.connect() calls. To exercise that path end to end, the
// #1132 tests below run the *real* WalletProvider and bridge its state into
// the mocked `useWallet` the button reads. Only the kit (a third-party web
// component that cannot render in jsdom) is faked, and the fake renders a real
// DOM dialog listing whichever adapters the test marks as installed.
type FakeAdapter = { id: string; name: string };

let installedAdapters: FakeAdapter[] = [];
const setWalletMock = jest.fn();
const getAddressMock = jest.fn(async () => ({
  address: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
}));
const getNetworkMock = jest.fn(async () => ({
  networkPassphrase: "Test SDF Network ; September 2015",
}));

// Plain functions (not jest.fn) so the file-level restoreAllMocks() in
// afterEach cannot strip their implementations between tests.
const fakeKit = {
  openModal: async (opts: {
    modalTitle?: string;
    onWalletSelected: (option: FakeAdapter) => Promise<void>;
  }) => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", opts.modalTitle ?? "Select a wallet");
    dialog.setAttribute("data-fake-wallet-modal", "true");
    for (const adapter of installedAdapters) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = adapter.name;
      option.addEventListener("click", async () => {
        dialog.remove();
        await opts.onWalletSelected(adapter);
      });
      dialog.appendChild(option);
    }
    document.body.appendChild(dialog);
  },
  setWallet: (id: string) => setWalletMock(id),
  getAddress: () => getAddressMock(),
  getNetwork: () => getNetworkMock(),
  disconnect: async () => {},
  signTransaction: async () => ({}),
};

jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit",
  () => ({
    kit: () => fakeKit,
    WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  }),
);

const providerStorage = new Map<string, string>();
jest.unstable_mockModule("../../src/templates/default/src/lib/storage", () => ({
  storage: {
    get: (key: string) => providerStorage.get(key) ?? null,
    set: (key: string, value: string) => {
      providerStorage.set(key, value);
    },
    remove: (key: string) => {
      providerStorage.delete(key);
    },
  },
}));

jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: function Server() {
      return {
        accounts: () => ({
          accountId: () => ({
            call: async () => ({
              balances: [{ balance: "100", asset_type: "native" }],
            }),
          }),
        }),
      };
    },
  },
  TransactionBuilder: function TransactionBuilder() {},
  Operation: { payment: () => ({}) },
  Networks: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  Asset: function Asset() {},
  Memo: { text: () => ({}) },
  BASE_FEE: "100",
}));

// ── Dynamic imports (must come after unstable_mockModule) ─────────────────────
const [
  { default: WalletConnectButton },
  { useWallet },
  { useStellarBalances },
  { WalletProvider: RealWalletProvider, useWallet: useRealWallet },
] = await Promise.all([
  import("../../src/templates/default/src/components/WalletConnectButton"),
  import("../../src/mocks/wallet-contexts-mock"),
  import("../../src/templates/default/src/hooks/useStellarBalances"),
  // Two `../` segments resolve to the real provider; jest.config.mjs only
  // remaps the single-`../` form the components themselves use.
  import("../../src/templates/default/src/contexts/WalletProvider"),
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_A = "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const ACCOUNT_B =
  "GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";

type WalletState = {
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  walletName?: string;
  accounts: string[];
  currentAccountIndex: number;
  switchAccount: (address: string) => Promise<void>;
  publicKey?: string;
};

/** Configures useWallet for a single test, filling in inert defaults. */
function mockWallet(partial: Partial<WalletState> = {}) {
  const state: WalletState = {
    connected: false,
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    walletName: undefined,
    accounts: [],
    currentAccountIndex: 0,
    switchAccount: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    publicKey: undefined,
    ...partial,
  };
  (useWallet as unknown as jest.Mock).mockReturnValue(state);
  return state;
}

type BalancesState = {
  balances: unknown[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  stopPolling: () => void;
};

/** Configures useStellarBalances for a single test, filling in inert defaults. */
function mockBalances(partial: Partial<BalancesState> = {}) {
  const state: BalancesState = {
    balances: [],
    loading: false,
    error: null,
    refresh: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopPolling: jest.fn(),
    ...partial,
  };
  (useStellarBalances as unknown as jest.Mock).mockReturnValue(state);
  return state;
}

/** The manual balance-refresh button, only rendered while connected. */
function getRefreshButton() {
  return screen.getByRole("button", {
    name: /refresh(ing)? balances/i,
  });
}

/** The primary connect/disconnect button. */
function getActionButton() {
  return screen.getByRole("button", {
    name: /connect wallet|disconnect|connecting|disconnecting/i,
  });
}

describe("WalletConnectButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBalances();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("disconnected state", () => {
    it('renders a "Connect Wallet" button', () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton />);

      expect(
        screen.getByRole("button", { name: /connect wallet/i }),
      ).toBeInTheDocument();
    });

    it("calls connect when the button is clicked", async () => {
      const state = mockWallet({ connected: false });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(state.connect).toHaveBeenCalledTimes(1);
      });
      expect(state.disconnect).not.toHaveBeenCalled();
    });

    it("does not render the account switcher while disconnected", () => {
      mockWallet({ connected: false, accounts: [ACCOUNT_A] });

      render(<WalletConnectButton />);

      // AccountSwitcher renders its own trigger button; only the connect
      // button should be present.
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
  });

  describe("connected state", () => {
    it("renders the wallet name in the disconnect label", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      expect(
        screen.getByRole("button", { name: /disconnect freighter/i }),
      ).toBeInTheDocument();
    });

    it("calls disconnect when the button is clicked", async () => {
      const state = mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(state.disconnect).toHaveBeenCalledTimes(1);
      });
      expect(state.connect).not.toHaveBeenCalled();
    });

    it("renders the account switcher when connected with accounts", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A, ACCOUNT_B],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      // The switcher adds a second button beside the disconnect button.
      expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    });

    it("does not render the account switcher when there are no accounts", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      // Disconnect button + refresh button, but no switcher trigger.
      expect(screen.getAllByRole("button")).toHaveLength(2);
    });
  });

  describe("balance refresh (#1069)", () => {
    it("does not render a refresh button while disconnected", () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton />);

      expect(
        screen.queryByRole("button", { name: /refresh(ing)? balances/i }),
      ).not.toBeInTheDocument();
    });

    it("renders a refresh button when connected", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      expect(getRefreshButton()).toBeInTheDocument();
    });

    it("calls the balances hook's refresh() when clicked", () => {
      const balances = mockBalances();
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getRefreshButton());

      expect(balances.refresh).toHaveBeenCalledTimes(1);
    });

    it('shows a "Refreshing balances" busy state while the refresh is in flight', () => {
      mockBalances({ loading: true });
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      const button = getRefreshButton();
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    });

    it("passes the wallet's public key to useStellarBalances so it can query the active account", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      expect(useStellarBalances).toHaveBeenCalledWith(ACCOUNT_A);
    });

    it("passes null to useStellarBalances while disconnected", () => {
      mockWallet({ connected: false, publicKey: undefined });

      render(<WalletConnectButton />);

      expect(useStellarBalances).toHaveBeenCalledWith(null);
    });
  });

  describe("in-flight state", () => {
    it('shows "Connecting..." and disables the button while connecting', async () => {
      let release!: () => void;
      const connect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /connecting/i }),
        ).toBeDisabled();
      });

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });

    it('shows "Disconnecting..." while disconnecting', async () => {
      let release!: () => void;
      const disconnect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
        disconnect,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /disconnecting/i }),
        ).toBeDisabled();
      });

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });

    it("ignores extra clicks while an action is in flight", async () => {
      let release!: () => void;
      const connect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      const button = getActionButton();
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });
      expect(connect).toHaveBeenCalledTimes(1);

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });
  });

  describe("failure handling", () => {
    it("re-enables the button when connect rejects", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const connect = jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("User rejected"));
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /connect wallet/i }),
        ).not.toBeDisabled();
      });
      expect(consoleError).toHaveBeenCalled();
    });

    it("re-enables the button when disconnect rejects", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const disconnect = jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Disconnect failed"));
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
        disconnect,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /disconnect freighter/i }),
        ).not.toBeDisabled();
      });
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe("theme", () => {
    it("applies light theme styling by default", () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton />);

      expect(getActionButton()).toHaveClass("bg-black", "text-white");
    });

    it("applies dark theme styling when theme is dark", () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton theme="dark" />);

      expect(getActionButton()).toHaveClass("bg-white", "text-black");
    });
  });

  describe("multi-wallet selection modal (#1132)", () => {
    /**
     * Renders the real WalletProvider and feeds its live state into the mocked
     * `useWallet` that WalletConnectButton reads, so clicking the button runs
     * the provider's real connect() against the fake kit above.
     */
    function RealWalletButton() {
      const realWallet = useRealWallet();
      (useWallet as unknown as jest.Mock).mockReturnValue(realWallet);
      return <WalletConnectButton />;
    }

    function renderWithRealProvider() {
      return render(
        <RealWalletProvider>
          <RealWalletButton />
        </RealWalletProvider>,
      );
    }

    const getConnectButton = () =>
      screen.getByRole("button", { name: /connect stellar wallet/i });

    beforeEach(() => {
      providerStorage.clear();
      setWalletMock.mockClear();
      getAddressMock.mockClear();
      installedAdapters = [
        { id: "freighter", name: "Freighter" },
        { id: "albedo", name: "Albedo" },
        { id: "xbull", name: "xBull" },
      ];
    });

    afterEach(() => {
      document
        .querySelectorAll("[data-fake-wallet-modal]")
        .forEach((node) => node.remove());
    });

    it("renders the selection modal instead of auto-connecting when more than one adapter is available", async () => {
      renderWithRealProvider();

      fireEvent.click(getConnectButton());

      const modal = await screen.findByRole("dialog");
      for (const { name } of installedAdapters) {
        expect(within(modal).getByRole("button", { name })).toBeInTheDocument();
      }

      // Nothing was connected on the user's behalf: no adapter was chosen,
      // no address was requested, and the button still offers to connect.
      expect(setWalletMock).not.toHaveBeenCalled();
      expect(getAddressMock).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: /disconnect/i }),
      ).not.toBeInTheDocument();
    });

    it("connects the adapter the user selects from the modal", async () => {
      renderWithRealProvider();

      fireEvent.click(getConnectButton());
      const modal = await screen.findByRole("dialog");

      // Pick the second adapter, not the first, so an implementation that
      // silently connects to adapters[0] would fail this test.
      fireEvent.click(within(modal).getByRole("button", { name: "Albedo" }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /disconnect albedo/i }),
        ).toBeInTheDocument();
      });
      expect(setWalletMock).toHaveBeenCalledTimes(1);
      expect(setWalletMock).toHaveBeenCalledWith("albedo");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
