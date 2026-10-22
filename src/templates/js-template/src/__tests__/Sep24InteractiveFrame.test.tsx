/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sep24InteractiveFrame from "../components/Sep24InteractiveFrame.jsx";

const ANCHOR_URL = "https://anchor.example.com/sep24/interactive?token=demo";
const ANCHOR_ORIGIN = "https://anchor.example.com";

/** Dispatch a `message` event as if it came from `origin`. */
function postMessageFrom(origin: string, data: unknown) {
  const event = new MessageEvent("message", { data, origin });
  window.dispatchEvent(event);
}

describe("Sep24InteractiveFrame", () => {
  it("renders nothing when no url is given", () => {
    const { container } = render(<Sep24InteractiveFrame url={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an iframe pointed at the given url, sandboxed", () => {
    render(<Sep24InteractiveFrame url={ANCHOR_URL} />);
    const frame = screen.getByTitle("Anchor interactive flow");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", ANCHOR_URL);
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("shows the transaction id when given", () => {
    render(
      <Sep24InteractiveFrame url={ANCHOR_URL} transactionId="tx-123" />
    );
    expect(screen.getByText("Transaction tx-123")).toBeInTheDocument();
  });

  it("renders a custom title on both the header and the iframe", () => {
    render(
      <Sep24InteractiveFrame url={ANCHOR_URL} title="Deposit with Acme Anchor" />
    );
    expect(screen.getByText("Deposit with Acme Anchor")).toBeInTheDocument();
    expect(screen.getByTitle("Deposit with Acme Anchor")).toBeInTheDocument();
  });

  it("does not render a close button when onClose is not given", () => {
    render(<Sep24InteractiveFrame url={ANCHOR_URL} />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("forwards a transaction message from the anchor's origin to onMessage", async () => {
    const onMessage = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onMessage={onMessage} />);

    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "pending_user_transfer_start" } });

    await waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1));
    expect(onMessage).toHaveBeenCalledWith({
      transaction: { status: "pending_user_transfer_start" },
    });
  });

  it("ignores a message from a different origin", async () => {
    const onMessage = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onMessage={onMessage} />);

    postMessageFrom("https://not-the-anchor.example.com", {
      transaction: { status: "completed" },
    });

    // Give any (incorrect) async handling a chance to run before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("ignores a same-origin message with no transaction field", async () => {
    const onMessage = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onMessage={onMessage} />);

    postMessageFrom(ANCHOR_ORIGIN, { somethingElse: true });

    await new Promise((r) => setTimeout(r, 0));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it.each(["completed", "refunded", "error"])(
    "calls onComplete when the transaction status reaches the terminal state %s",
    async (status) => {
      const onComplete = jest.fn();
      render(<Sep24InteractiveFrame url={ANCHOR_URL} onComplete={onComplete} />);

      postMessageFrom(ANCHOR_ORIGIN, { transaction: { status, id: "tx-1" } });

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(onComplete).toHaveBeenCalledWith({ status, id: "tx-1" });
    }
  );

  it("does not call onComplete for a non-terminal status", async () => {
    const onComplete = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onComplete={onComplete} />);

    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "pending_anchor" } });

    await new Promise((r) => setTimeout(r, 0));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("only calls onComplete once even if multiple terminal messages arrive", async () => {
    const onComplete = jest.fn();
    render(<Sep24InteractiveFrame url={ANCHOR_URL} onComplete={onComplete} />);

    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "completed" } });
    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "completed" } });

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("stops listening after unmount", async () => {
    const onMessage = jest.fn();
    const { unmount } = render(
      <Sep24InteractiveFrame url={ANCHOR_URL} onMessage={onMessage} />
    );
    unmount();

    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "completed" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("resets its completed-once guard when the url changes", async () => {
    const onComplete = jest.fn();
    const { rerender } = render(
      <Sep24InteractiveFrame url={ANCHOR_URL} onComplete={onComplete} />
    );
    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "completed" } });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    const secondUrl = "https://anchor.example.com/sep24/interactive?token=second";
    rerender(<Sep24InteractiveFrame url={secondUrl} onComplete={onComplete} />);
    postMessageFrom(ANCHOR_ORIGIN, { transaction: { status: "completed" } });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
  });
});
