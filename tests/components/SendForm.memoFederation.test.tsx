/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StellarToml } from "@stellar/stellar-sdk";
import SendForm from "../../src/templates/default/src/components/SendForm";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
// SendForm imports "../contexts", which jest maps to this mock.
import { WalletContext } from "../../src/mocks/wallet-contexts-mock";

const RECIPIENT = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const EXCHANGE = "GBTL47RTFR5EKMZSXWOQU735WBK7LRPPDIDK3JTNTCZZ7NUBBRDTVSK2";
const HASH = "ab".repeat(32);

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");
const sendPayment = jest.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/** Mocked federation server for example.com. */
const federationRecords: Record<string, Record<string, unknown>> = {
  "alice*example.com": {
    stellar_address: "alice*example.com",
    account_id: RECIPIENT,
  },
  "deposit*exchange.com": {
    stellar_address: "deposit*exchange.com",
    account_id: EXCHANGE,
    memo_type: "id",
    memo: "987654",
  },
};

function renderForm() {
  // No publicKey, so useStellarBalances stays idle and no Horizon call is made.
  return render(
    <WalletContext.Provider
      value={{ connected: true, publicKey: undefined, sendPayment }}
    >
      <SendForm />
    </WalletContext.Provider>,
  );
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SendForm memo support (#951)", () => {
  beforeEach(() => {
    sendPayment.mockReset().mockResolvedValue({ hash: "tx" });
  });

  it("offers none / text / id / hash / return memo types", () => {
    renderForm();
    const options = Array.from(
      (screen.getByLabelText("Memo type") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["none", "text", "id", "hash", "return"]);
  });

  it.each([
    ["text", "x".repeat(29), /29 bytes/],
    ["id", "12ab", /whole number/],
    ["id", "", /Enter a ID memo or choose None/],
    ["hash", "abc", /64 hexadecimal/],
    ["return", "z".repeat(64), /64 hexadecimal/],
  ])("validates a %s memo and blocks submit", (memoType, value, message) => {
    renderForm();
    type("To", RECIPIENT);
    type("Amount (XLM)", "5");
    type("Memo type", memoType);
    type("Memo (optional)", value);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Memo (optional)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it.each([
    ["text", "invoice 42", "invoice 42"],
    [
      "id",
      "18446744073709551615",
      { type: "id", value: "18446744073709551615" },
    ],
    ["hash", HASH, { type: "hash", value: HASH }],
    ["return", HASH, { type: "return", value: HASH }],
  ])("passes a %s memo to sendPayment", async (memoType, value, expected) => {
    renderForm();
    type("To", RECIPIENT);
    type("Amount (XLM)", "5");
    type("Memo type", memoType);
    type("Memo (optional)", value);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ to: RECIPIENT, amount: "5", memo: expected }),
      ),
    );
  });

  it("sends no memo for type None and disables the memo input", async () => {
    renderForm();
    type("To", RECIPIENT);
    type("Amount (XLM)", "5");
    type("Memo (optional)", "ignored");
    type("Memo type", "none");

    expect(screen.getByLabelText("Memo (optional)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendPayment).toHaveBeenCalled());
    expect(sendPayment.mock.calls[0][0].memo).toBeUndefined();
  });

  it("shows the wallet's error when building the transaction fails", async () => {
    sendPayment.mockRejectedValue(
      new Error("ID memo must fit in an unsigned 64-bit integer."),
    );
    renderForm();
    type("To", RECIPIENT);
    type("Amount (XLM)", "5");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText(
        "ID memo must fit in an unsigned 64-bit integer.",
      ),
    ).toBeInTheDocument();
  });
});

describe("SendForm federation addresses (#950)", () => {
  beforeEach(() => {
    sendPayment.mockReset().mockResolvedValue({ hash: "tx" });
    mockResolve.mockReset();
    clearStellarTomlCache();
    mockResolve.mockImplementation(
      async (domain: string) =>
        (domain === "nofed.com"
          ? {}
          : { FEDERATION_SERVER: `https://${domain}/federation` }) as never,
    );
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const q = new URL(String(url)).searchParams.get("q") ?? "";
      const record = federationRecords[q];
      return record
        ? jsonResponse(record)
        : jsonResponse({ detail: "not found" }, 404);
    }) as typeof fetch;
  });

  it("resolves name*domain and sends to the resolved account", async () => {
    renderForm();
    type("To", "alice*example.com");
    type("Amount (XLM)", "12");

    expect(
      await screen.findByText(/Resolves to GDVEU3/, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Memo type")).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({ to: RECIPIENT, amount: "12" }),
      ),
    );
  });

  it("pre-fills and locks a memo required by the federation server", async () => {
    renderForm();
    type("Memo (optional)", "my own memo");
    type("To", "deposit*exchange.com");
    type("Amount (XLM)", "100");

    expect(
      await screen.findByText(
        "Memo required by deposit*exchange.com (locked).",
        undefined,
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    const memoType = screen.getByLabelText("Memo type") as HTMLSelectElement;
    const memo = screen.getByLabelText("Memo (optional)") as HTMLInputElement;
    expect(memoType).toBeDisabled();
    expect(memoType.value).toBe("id");
    expect(memo).toHaveAttribute("readonly");
    expect(memo.value).toBe("987654");

    // Typing into the locked field cannot change the memo that is sent.
    type("Memo (optional)", "123");
    expect(memo.value).toBe("987654");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: EXCHANGE,
          memo: { type: "id", value: "987654" },
        }),
      ),
    );
  });

  it("unlocks the memo again when the recipient changes to a plain key", async () => {
    renderForm();
    type("To", "deposit*exchange.com");
    await screen.findByText(/locked/, undefined, { timeout: 3000 });

    type("To", RECIPIENT);
    expect(screen.getByLabelText("Memo type")).not.toBeDisabled();
    expect(screen.getByLabelText("Memo (optional)")).not.toHaveAttribute(
      "readonly",
    );
  });

  it.each([
    ["ghost*example.com", "No Stellar account found for ghost*example.com."],
    ["alice*nofed.com", "nofed.com does not support federation addresses."],
  ])(
    "shows a clear error for an unresolved address (%s)",
    async (address, message) => {
      renderForm();
      type("To", address);
      type("Amount (XLM)", "1");

      expect(
        await screen.findByText(message, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("To")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    },
  );

  it("rejects a malformed federation address immediately", () => {
    renderForm();
    type("To", "alice*");
    expect(
      screen.getByText('"alice*" is not a valid federation address.'),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps submit disabled while the address is resolving", () => {
    renderForm();
    type("To", "alice*example.com");
    type("Amount (XLM)", "1");
    expect(
      screen.getByText("Resolving federation address…"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
