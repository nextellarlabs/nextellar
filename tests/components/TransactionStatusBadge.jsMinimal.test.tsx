/**
 * @jest-environment jsdom
 *
 * TransactionStatusBadge Component Tests — js-minimal template
 *
 * Verifies the js-minimal TransactionStatusBadge renders status states,
 * custom labels, and machine-readable data attributes identically to the TS template.
 */
import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";

// @ts-expect-error importing .jsx component in test file
import TransactionStatusBadge from "../../src/templates/js-minimal/src/components/TransactionStatusBadge";

const ALL_STATUSES = ["pending", "success", "failed"] as const;

describe("TransactionStatusBadge (js-minimal template)", () => {
  it.each([
    ["pending", "Pending"],
    ["success", "Success"],
    ["failed", "Failed"],
  ] as const)('labels the %s state "%s"', (status, expected) => {
    render(<TransactionStatusBadge status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(expected);
  });

  it("exposes the machine-readable status attribute", () => {
    render(<TransactionStatusBadge status="failed" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-status", "failed");
  });

  it("accepts a custom label override", () => {
    render(
      <TransactionStatusBadge status="pending" label="Awaiting signature" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Awaiting signature");
  });
});
