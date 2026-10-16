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
});
