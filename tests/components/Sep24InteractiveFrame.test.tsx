/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import Sep24InteractiveFrame from "../../src/templates/default/src/components/Sep24InteractiveFrame";

describe("Sep24InteractiveFrame (#1051)", () => {
  it("renders a sandboxed iframe for an https URL", () => {
    render(
      <Sep24InteractiveFrame url="https://anchor.example.com/kyc?callback=postMessage" />,
    );
    const frame = screen.getByTitle("Anchor deposit and withdrawal");
    expect(frame.getAttribute("src")).toBe(
      "https://anchor.example.com/kyc?callback=postMessage",
    );
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-forms allow-popups",
    );
  });

  it.each(["javascript:alert(1)", "http://evil.example/kyc", "not a url"])(
    "renders nothing for an unsafe URL (%s)",
    (url) => {
      const { container } = render(<Sep24InteractiveFrame url={url} />);
      expect(container.querySelector("iframe")).toBeNull();
    },
  );

  it("calls onClose from the close button", () => {
    const onClose = jest.fn();
    render(
      <Sep24InteractiveFrame
        url="https://anchor.example.com/kyc"
        onClose={onClose}
        closeLabel="Done"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("modal keyboard navigation (#1278)", () => {
    it("renders as a dialog only when onClose is provided", () => {
      const { rerender } = render(
        <Sep24InteractiveFrame url="https://anchor.example.com/kyc" />,
      );
      expect(screen.queryByRole("dialog")).toBeNull();

      rerender(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={jest.fn()}
        />,
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("moves focus into the dialog (the close button) on open", () => {
      render(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={jest.fn()}
          closeLabel="Done"
        />,
      );
      expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    });

    it("calls onClose when Escape is pressed", () => {
      const onClose = jest.fn();
      render(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={onClose}
        />,
      );

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("traps focus: Tab from the last focusable element (the iframe) wraps to the first (the close button)", () => {
      const onClose = jest.fn();
      const { container } = render(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={onClose}
          closeLabel="Done"
        />,
      );

      // The dialog's two focusable elements are the close button and the
      // iframe itself; the trap must wrap Tab from the last back to the
      // first instead of letting it escape to the page behind the dialog.
      const closeButton = screen.getByRole("button", { name: "Done" });
      const frame = container.querySelector("iframe") as HTMLIFrameElement;
      frame.focus();
      expect(frame).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab" });

      expect(closeButton).toHaveFocus();
    });

    it("traps focus: Shift+Tab from the first focusable element (the close button) wraps to the last (the iframe)", () => {
      const onClose = jest.fn();
      const { container } = render(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={onClose}
          closeLabel="Done"
        />,
      );

      const closeButton = screen.getByRole("button", { name: "Done" });
      const frame = container.querySelector("iframe") as HTMLIFrameElement;
      closeButton.focus();
      expect(closeButton).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(frame).toHaveFocus();
    });

    it("restores focus to the previously focused element once the dialog unmounts", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(trigger).toHaveFocus();

      const { unmount } = render(
        <Sep24InteractiveFrame
          url="https://anchor.example.com/kyc"
          onClose={jest.fn()}
        />,
      );
      expect(trigger).not.toHaveFocus();

      unmount();

      expect(trigger).toHaveFocus();
      trigger.remove();
    });
  });
});
