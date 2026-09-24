/**
 * @jest-environment jsdom
 *
 * TransactionStatusBadge Component Tests — minimal template (#812)
 *
 * The minimal template ships TransactionStatusBadge byte-identical to default.
 * This verifies the minimal copy renders every status with the same markup,
 * backed by a per-template snapshot so any drift from the shared component
 * is caught.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import TransactionStatusBadge, {
  type TransactionStatus,
} from "../../src/templates/minimal/src/components/TransactionStatusBadge";

const ALL_STATUSES: TransactionStatus[] = ["pending", "success", "failed"];

describe("TransactionStatusBadge (minimal template)", () => {
  it.each(ALL_STATUSES)(
    "renders the %s state consistently (snapshot)",
    (status) => {
      const { container } = render(<TransactionStatusBadge status={status} />);
      expect(container.firstChild).toMatchSnapshot();
    },
  );

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
