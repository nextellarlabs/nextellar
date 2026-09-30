/**
 * @jest-environment jsdom
 *
 * SendForm keyboard-navigation audit (#1138).
 *
 * Asserts the form is fully operable with the keyboard alone, via
 * @testing-library/user-event's real event dispatch (not fireEvent, which
 * bypasses focus/selection semantics):
 *
 * - Tab order: DOM order equals visual order — To → Asset → Amount →
 *   Memo → Fee Sponsor → submit — and Shift+Tab reverses it exactly.
 * - Enter-to-submit: implicit submission fires from any text field via the
 *   same path a browser uses (a click on the form's default submit button),
 *   and is correctly inert while the form is invalid or in flight.
 * - No keyboard traps: forward and reverse traversal reaches every control
 *   and exits past the form's first and last controls.
 * - The asset <select> is in the tab order and its selection drives the
 *   form; arrow-key option picking is native browser behaviour that jsdom
 *   does not implement, so option selection is asserted with user-event's
 *   selectOptions (the same change contract the keyboard path produces).
 * - Disabled controls are skipped rather than snagging focus.
 * - The read-only fee-bump XDR textarea is tab-reachable and self-selecting
 *   so a keyboard-only sponsor can copy the envelope without a pointer.
 *
 * A DOM-order cycle is asserted instead of a literal tab-loop: the form is
 * rendered into a document with nothing else focusable around it, so cycling
 * from its last control back into the form's first control is exactly what
 * the browser does and proves no control traps focus.
 */
import "@testing-library/jest-dom";
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
  // Mirrors WalletProvider's real type guard; the component branches on it.
  isUnsignedFeeBumpResult: (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    (value as { requiresSponsorSignature?: unknown })
      .requiresSponsorSignature === true,
}));

jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

// Dynamic imports (must come after unstable_mockModule).
const [{ default: SendForm }, { useWallet }, { useStellarBalances }] =
  await Promise.all([
    import("../../src/templates/default/src/components/SendForm"),
    import("../../src/mocks/wallet-contexts-mock"),
    import("../../src/templates/default/src/hooks/useStellarBalances"),
  ]);

const VALID_ADDRESS =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

type WalletState = {
  connected: boolean;
  publicKey?: string;
  sendPayment?: (opts: unknown) => Promise<unknown>;
};

function mockSendPaymentImpl(): jest.Mock<() => Promise<unknown>> {
  return jest.fn<() => Promise<unknown>>().mockResolvedValue({});
}

function mockWallet(partial: Partial<WalletState> = {}) {
  (useWallet as unknown as jest.Mock).mockReturnValue({
    connected: true,
    publicKey: VALID_ADDRESS,
    sendPayment: mockSendPaymentImpl(),
    ...partial,
  });
}

function mockBalances() {
  (useStellarBalances as unknown as jest.Mock).mockReturnValue({
    balances: [
      { asset_type: "native", balance: "100.0000000" },
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        balance: "50.0000000",
      },
    ],
    loading: false,
    error: null,
    refresh: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopPolling: jest.fn(),
  });
}

/** The form's controls in DOM (== visual) order, all enabled by default. */
function formControlSequence() {
  return [
    screen.getByLabelText("To"),
    screen.getByLabelText("Asset"),
    screen.getByLabelText(/Amount \(/),
    screen.getByLabelText("Memo (optional)"),
    screen.getByLabelText("Fee Sponsor (optional fee-bump)"),
    screen.getByRole("button", { name: /send/i }),
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWallet();
  mockBalances();
});

afterEach(() => {
  cleanup();
});

describe("SendForm keyboard-navigation audit (#1138)", () => {
  it("traverses every control in DOM order with Tab and loops back with no trap", async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    // Fill the required fields so the submit button is enabled — the audit
    // covers the complete, submittable form (a disabled submit is skipped by
    // tabbing, which the disabled-controls test below covers explicitly).
    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (XLM)"), "10");

    const sequence = formControlSequence();

    // Start traversal at the form's first control.
    sequence[0].focus();
    expect(document.activeElement).toBe(sequence[0]);

    for (let i = 1; i < sequence.length; i++) {
      await user.tab();
      expect(document.activeElement).toBe(sequence[i]);
    }

    // Cycling past the last control wraps to the document body...
    await user.tab();
    expect(document.activeElement).toBe(document.body);

    // ...and a further Tab re-enters the form at its first control, proving
    // focus is never captured anywhere along the cycle (no keyboard trap).
    await user.tab();
    expect(document.activeElement).toBe(sequence[0]);
  });

  it("reverses the sequence exactly with Shift+Tab", async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    // Same filled-form precondition as the forward traversal above.
    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (XLM)"), "10");

    const sequence = formControlSequence();

    // Walk forward to the submit button, then reverse the whole sequence.
    sequence[sequence.length - 1].focus();
    expect(document.activeElement).toBe(sequence[sequence.length - 1]);

    for (let i = sequence.length - 2; i >= 0; i--) {
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(sequence[i]);
    }

    // Exiting backwards past the first control lands on the body — again no
    // trap in the reverse direction.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(document.body);
  });

  it("submits the form with Enter from the first and the last text field", async () => {
    const user = userEvent.setup();
    const mockSendPayment = mockSendPaymentImpl();
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    const amountInput = screen.getByLabelText("Amount (XLM)");

    // Enter while still in the first field submits — no mouse needed. The
    // amount must be filled too: an incomplete form keeps its default submit
    // button disabled, and browsers do not implicit-submit then either.
    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(amountInput, "10");
    await user.type(screen.getByLabelText("To"), "{Enter}");

    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ to: VALID_ADDRESS, amount: "10" }),
      );
    });
    expect(await screen.findByText("Sent")).toBeInTheDocument();

    // Same contract from the last field: refill the cleared form and press
    // Enter inside Memo.
    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (XLM)"), "25");
    await user.type(screen.getByLabelText("Memo (optional)"), "rent{Enter}");

    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ to: VALID_ADDRESS, memo: "rent" }),
      );
    });
    expect(await screen.findByText("Sent")).toBeInTheDocument();

    // The amount input referenced earlier is the same node React reuses.
    expect(amountInput).toBeInTheDocument();
  });

  it("does not submit on Enter while a validation error is showing", async () => {
    const user = userEvent.setup();
    const mockSendPayment = mockSendPaymentImpl();
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    await user.type(screen.getByLabelText("To"), "not-a-stellar-address");
    await user.type(screen.getByLabelText("Amount (XLM)"), "10");
    await user.type(screen.getByLabelText("Memo (optional)"), "{Enter}");

    expect(mockSendPayment).not.toHaveBeenCalled();
    expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
  });

  it("keeps the asset select in the tab order and reacts to a keyboard-driven selection change", async () => {
    const user = userEvent.setup();
    const mockSendPayment = mockSendPaymentImpl();
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    // Tab order reaches the select from the To field.
    screen.getByLabelText("To").focus();
    await user.tab();
    const assetSelect = screen.getByLabelText("Asset");
    expect(document.activeElement).toBe(assetSelect);

    // Arrow-key option picking is native browser behaviour jsdom does not
    // implement; assert the same observable contract (a change event moving
    // the selection) via user-event's selectOptions, which is what the
    // keyboard path also produces.
    await user.selectOptions(assetSelect, "USDC");
    expect(assetSelect).toHaveValue("USDC");
    // The amount label follows the selection so the field stays unambiguous.
    expect(screen.getByLabelText("Amount (USDC)")).toBeInTheDocument();

    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (USDC)"), "5");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          asset: { code: "USDC", issuer: USDC_ISSUER },
        }),
      );
    });
  });

  it("skips disabled controls during traversal instead of trapping on them", async () => {
    const user = userEvent.setup();
    mockWallet({
      connected: false,
      publicKey: undefined,
      sendPayment: undefined,
    });
    render(<SendForm />);

    // Disconnected: every control renders disabled, including the submit
    // button. Nothing in the form can take focus, so traversal is a no-op
    // that lands on (and stays on) the body — disabled controls are skipped
    // by tabbing, never traps.
    expect(screen.getByLabelText("To")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();

    screen.getByLabelText("To").focus(); // no-op on a disabled element
    expect(document.activeElement).toBe(document.body);

    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it("reaches the read-only fee-bump XDR by keyboard, self-selecting it on focus", async () => {
    const user = userEvent.setup();
    const mockSendPayment = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({
        requiresSponsorSignature: true,
        feeBumpXdr: "AAAAAgAAAABzZQ==",
      });
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (XLM)"), "10");
    await user.type(
      screen.getByLabelText("Fee Sponsor (optional fee-bump)"),
      VALID_ADDRESS,
    );
    await user.click(
      screen.getByRole("button", { name: /send with fee-bump/i }),
    );

    expect(
      await screen.findByText(/needs the fee sponsor/i),
    ).toBeInTheDocument();

    const xdrBox = screen.getByLabelText(
      "Unsigned fee-bump transaction XDR",
    ) as HTMLTextAreaElement;
    expect(xdrBox).toHaveAttribute("readonly");

    // Tab through the whole form: the textarea is part of the focusable
    // sequence, so a keyboard-only sponsor can reach and copy the envelope.
    screen.getByLabelText("To").focus();
    let reached = false;
    for (let i = 0; i < 10; i++) {
      await user.tab();
      if (document.activeElement === xdrBox) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);

    // Focusing the textarea selects its whole content, so Ctrl/Cmd+C copies
    // the XDR without any pointer interaction.
    expect(xdrBox.selectionStart).toBe(0);
    expect(xdrBox.selectionEnd).toBe(xdrBox.value.length);
  });

  it("disables the submit button during an in-flight submission so Enter cannot double-send", async () => {
    const user = userEvent.setup();
    let resolveSend!: (value: unknown) => void;
    const mockSendPayment = jest
      .fn<() => Promise<unknown>>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve;
          }),
      );
    mockWallet({ sendPayment: mockSendPayment });
    render(<SendForm />);

    await user.type(screen.getByLabelText("To"), VALID_ADDRESS);
    await user.type(screen.getByLabelText("Amount (XLM)"), "10");

    const submit = screen.getByRole("button", { name: /send/i });
    await user.click(submit);

    // While the payment is in flight the button is disabled and shows the
    // in-flight label.
    expect(submit).toBeDisabled();
    expect(screen.getByText("Sending…")).toBeInTheDocument();

    // An Enter keypress during flight must not re-submit.
    await user.type(screen.getByLabelText("Amount (XLM)"), "{Enter}");
    expect(mockSendPayment).toHaveBeenCalledTimes(1);

    resolveSend({});
    expect(await screen.findByText("Sent")).toBeInTheDocument();
    expect(mockSendPayment).toHaveBeenCalledTimes(1);
  });
});
