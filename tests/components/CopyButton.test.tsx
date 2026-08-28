/**
 * @jest-environment jsdom
 *
 * Coverage for #842: copy-to-clipboard with toast feedback for addresses
 * and transaction hashes.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CopyButton from "../../src/templates/default/src/components/CopyButton";

describe("CopyButton", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it("has an accessible name that reflects the label prop", () => {
    render(<CopyButton value="GABC123" label="address" />);
    expect(
      screen.getByRole("button", { name: /copy address/i }),
    ).toBeInTheDocument();
  });

  it('defaults the label to "text" when none is given', () => {
    render(<CopyButton value="GABC123" />);
    expect(
      screen.getByRole("button", { name: /copy text/i }),
    ).toBeInTheDocument();
  });

  it("copies the value to the clipboard on click", async () => {
    render(<CopyButton value="GABC123" label="address" />);
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("GABC123");
    });
  });

  it('updates the accessible name to "<label> copied" after a successful copy', async () => {
    render(<CopyButton value="GABC123" label="address" />);
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^address copied$/i }),
      ).toBeInTheDocument();
    });
  });

  it("announces the copy via an aria-live region even without visible confirmation text", async () => {
    render(<CopyButton value="txhash123" label="transaction hash" />);
    fireEvent.click(
      screen.getByRole("button", { name: /copy transaction hash/i }),
    );

    const status = await screen.findByText(
      /transaction hash copied to clipboard/i,
    );
    expect(status).toHaveClass("sr-only");
  });

  it("shows a visible confirmation line when showConfirmationText is set", async () => {
    render(<CopyButton value="GABC123" label="address" showConfirmationText />);
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    const confirmation = await screen.findByText(
      /address copied to clipboard/i,
    );
    expect(confirmation).not.toHaveClass("sr-only");
  });

  it("does not show a visible confirmation before any copy has happened", () => {
    render(<CopyButton value="GABC123" label="address" showConfirmationText />);
    expect(screen.queryByText(/copied to clipboard/i)).not.toBeInTheDocument();
  });
});
