/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import type { ComponentType } from "react";
import { WalletProvider } from "../../src/mocks/wallet-contexts-mock";

// #1145: the QR image's alt text must describe its purpose rather than repeat
// the address, which is already rendered (and read) as text right below it.

expect.extend(toHaveNoViolations);

const ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

const templates: Array<
  [string, () => Promise<{ default: ComponentType<any> }>]
> = [
  [
    "default",
    () => import("../../src/templates/default/src/components/ReceiveForm"),
  ],
  ["defi", () => import("../../src/templates/defi/src/components/ReceiveForm")],
  [
    "minimal",
    () => import("../../src/templates/minimal/src/components/ReceiveForm"),
  ],
];

/** Every string a screen reader would announce from text, alt and aria-label. */
function announcedText(container: HTMLElement): string {
  const labels = Array.from(
    container.querySelectorAll("[alt], [aria-label]"),
  ).map(
    (el) =>
      `${el.getAttribute("alt") ?? ""} ${el.getAttribute("aria-label") ?? ""}`,
  );
  return [container.textContent ?? "", ...labels].join(" ");
}

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe.each(templates)(
  "ReceiveForm QR alt text (%s template, #1145)",
  (_name, load) => {
    let ReceiveForm: ComponentType<any>;

    beforeAll(async () => {
      ReceiveForm = (await load()).default;
    });

    const renderForm = (props: Record<string, unknown> = {}) =>
      render(
        <WalletProvider>
          <ReceiveForm address={ADDRESS} {...props} />
        </WalletProvider>,
      );

    it("gives the QR image a purpose-describing alt that does not repeat the address", async () => {
      renderForm();

      const img = await screen.findByRole("img", { name: /qr code/i });
      const alt = img.getAttribute("alt") ?? "";
      expect(alt).toMatch(/scannable qr code/i);
      expect(alt).toMatch(/shown below/i);
      expect(alt).not.toContain(ADDRESS);
      expect(alt).not.toContain(ADDRESS.slice(0, 8));
    });

    it("announces the address exactly once (from the visible text)", async () => {
      const { container } = renderForm();
      await screen.findByRole("img", { name: /qr code/i });

      expect(screen.getByTestId("receive-form-address")).toHaveTextContent(
        ADDRESS,
      );
      expect(occurrences(announcedText(container), ADDRESS)).toBe(1);
    });

    it("does not put an aria-label on the generic QR wrapper", async () => {
      renderForm();
      await screen.findByRole("img", { name: /qr code/i });

      expect(screen.getByTestId("receive-form-qr")).not.toHaveAttribute(
        "aria-label",
      );
    });

    it("exposes the loading placeholder as a labelled status before the QR is ready", () => {
      renderForm();

      expect(
        screen.getByRole("status", { name: "Loading QR code" }),
      ).toBeInTheDocument();
    });

    it("has no axe violations once the QR has rendered", async () => {
      const { container } = renderForm();
      await screen.findByRole("img", { name: /qr code/i });

      expect(await axe(container)).toHaveNoViolations();
    });
  },
);

describe("ReceiveForm SEP-7 QR alt text (default template, #1145)", () => {
  it("describes a payment request without repeating the address", async () => {
    const { default: ReceiveForm } =
      await import("../../src/templates/default/src/components/ReceiveForm");
    const { container } = render(
      <WalletProvider>
        <ReceiveForm address={ADDRESS} amount="25" />
      </WalletProvider>,
    );

    const img = await screen.findByRole("img", { name: /payment request/i });
    expect(img.getAttribute("alt")).not.toContain(ADDRESS);
    await waitFor(() =>
      expect(occurrences(announcedText(container), ADDRESS)).toBe(1),
    );
  });
});
