/**
 * @jest-environment jsdom
 */
import React from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { Account, Keypair, MuxedAccount, StrKey } from "@stellar/stellar-sdk";

expect.extend(toHaveNoViolations);
import {
  I18nContext,
  I18nProvider,
} from "../../src/templates/default/src/contexts/I18nProvider";
import { en } from "../../src/templates/default/src/locales/en";
import AddressInput, {
  normalizeStellarAddress,
  validateStellarAddress,
  type AddressValidationResult,
} from "../../src/templates/default/src/components/AddressInput";

const VALID_ACCOUNT = Keypair.random().publicKey();
const VALID_MUXED = new MuxedAccount(
  new Account(VALID_ACCOUNT, "1"),
  "987654",
).accountId();
const VALID_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));

function tamperLastChar(address: string): string {
  const last = address[address.length - 1];
  const replacement = last === "A" ? "B" : "A";
  return `${address.slice(0, -1)}${replacement}`;
}

describe("AddressInput (#1467)", () => {
  const writeTextMock = jest.fn<() => Promise<void>>();
  const readTextMock = jest.fn<() => Promise<string>>();

  beforeEach(() => {
    jest.clearAllMocks();
    writeTextMock.mockResolvedValue(undefined);
    readTextMock.mockResolvedValue(VALID_ACCOUNT);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
        readText: readTextMock,
      },
    });
  });

  describe("validateStellarAddress & normalizeStellarAddress helpers", () => {
    it("validates classic G..., muxed M..., and contract C... StrKey checksums", () => {
      expect(validateStellarAddress(VALID_ACCOUNT)).toEqual({
        isValid: true,
        isEmpty: false,
        normalized: VALID_ACCOUNT,
        prefix: "G",
        kind: "account",
        errorCode: null,
      });

      expect(validateStellarAddress(VALID_MUXED)).toEqual({
        isValid: true,
        isEmpty: false,
        normalized: VALID_MUXED,
        prefix: "M",
        kind: "muxed",
        errorCode: null,
      });

      expect(validateStellarAddress(VALID_CONTRACT)).toEqual({
        isValid: true,
        isEmpty: false,
        normalized: VALID_CONTRACT,
        prefix: "C",
        kind: "contract",
        errorCode: null,
      });
    });

    it("normalizes whitespace and lowercase StrKey inputs to uppercase", () => {
      const messy = `  ${VALID_ACCOUNT.toLowerCase()}  `;
      expect(normalizeStellarAddress(messy)).toBe(VALID_ACCOUNT);
      const res = validateStellarAddress(messy);
      expect(res.isValid).toBe(true);
      expect(res.normalized).toBe(VALID_ACCOUNT);
    });

    it("rejects corrupted StrKey CRC16 checksums for G, M, and C addresses", () => {
      expect(
        validateStellarAddress(tamperLastChar(VALID_ACCOUNT)),
      ).toMatchObject({
        isValid: false,
        errorCode: "invalid_account_checksum",
      });
      expect(validateStellarAddress(tamperLastChar(VALID_MUXED))).toMatchObject(
        {
          isValid: false,
          errorCode: "invalid_muxed_checksum",
        },
      );
      expect(
        validateStellarAddress(tamperLastChar(VALID_CONTRACT)),
      ).toMatchObject({
        isValid: false,
        errorCode: "invalid_contract_checksum",
      });
    });

    it("enforces allowedTypes filtering", () => {
      const res = validateStellarAddress(VALID_CONTRACT, {
        allowedTypes: ["G", "M"],
      });
      expect(res.isValid).toBe(false);
      expect(res.kind).toBe("contract");
      expect(res.errorCode).toBe("disallowed_type");
    });
  });

  it("emits normalized value and validity state when typing or pasting", async () => {
    const onChange =
      jest.fn<(value: string, validation: AddressValidationResult) => void>();
    const onValidityChange =
      jest.fn<
        (isValid: boolean, validation: AddressValidationResult) => void
      >();

    render(
      <I18nProvider>
        <AddressInput onChange={onChange} onValidityChange={onValidityChange} />
      </I18nProvider>,
    );

    const input = screen.getByLabelText("Stellar address");
    fireEvent.change(input, {
      target: { value: ` ${VALID_CONTRACT.toLowerCase()} ` },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      VALID_CONTRACT,
      expect.objectContaining({
        isValid: true,
        kind: "contract",
        normalized: VALID_CONTRACT,
      }),
    );

    await waitFor(() => {
      expect(onValidityChange).toHaveBeenLastCalledWith(
        true,
        expect.objectContaining({ isValid: true, kind: "contract" }),
      );
    });
    expect(
      screen.getByText("Valid Soroban contract address (C...)"),
    ).toBeInTheDocument();
  });

  it("renders accessible inline errors for invalid checksums and disallowed prefixes", () => {
    render(
      <I18nProvider>
        <AddressInput allowedTypes={["G"]} required />
      </I18nProvider>,
    );

    const input = screen.getByLabelText("Stellar address");

    // Empty required field surfaces error on blur
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Stellar address is required.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");

    // Invalid G checksum
    fireEvent.change(input, {
      target: { value: tamperLastChar(VALID_ACCOUNT) },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid classic account (G...) checksum or length.",
    );

    // Valid C address when only G is allowed
    fireEvent.change(input, { target: { value: VALID_CONTRACT } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Address type C... is not allowed here (accepted: G...).",
    );
  });

  it("supports Paste, Copy, and Clear buttons and surfaces clipboard errors", async () => {
    readTextMock.mockResolvedValueOnce(`  ${VALID_MUXED.toLowerCase()} `);

    render(<AddressInput />);

    fireEvent.click(screen.getByRole("button", { name: "Paste address" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Stellar address")).toHaveValue(VALID_MUXED);
    });
    expect(
      screen.getByText("Valid Stellar muxed account (M...)"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(VALID_MUXED);
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear address" }));
    expect(screen.getByLabelText("Stellar address")).toHaveValue("");

    // Clipboard read failure surfaces accessible inline alert
    readTextMock.mockRejectedValueOnce(new Error("Permission denied"));
    fireEvent.click(screen.getByRole("button", { name: "Paste address" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Unable to read from clipboard. Paste manually instead.",
      );
    });
  });

  it("reads translated strings from a custom I18nContext provider", () => {
    const customMessages = {
      ...en,
      addressInput: {
        ...en.addressInput,
        label: "Custom Localized Address Label",
      },
    };

    render(
      <I18nContext.Provider
        value={{
          locale: "en",
          messages: customMessages as unknown as typeof en,
          setLocale: () => {},
          availableLocales: ["en"],
          t: (path) =>
            path === "addressInput.label"
              ? "Custom Localized Address Label"
              : path,
        }}
      >
        <AddressInput />
      </I18nContext.Provider>,
    );

    expect(
      screen.getByLabelText("Custom Localized Address Label"),
    ).toBeInTheDocument();
  });

  it("has zero jest-axe accessibility violations across empty, valid, and error states", async () => {
    const { container, rerender } = render(
      <I18nProvider>
        <AddressInput value="" />
      </I18nProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <I18nProvider>
        <AddressInput value={VALID_ACCOUNT} />
      </I18nProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <I18nProvider>
        <AddressInput value={tamperLastChar(VALID_ACCOUNT)} />
      </I18nProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
