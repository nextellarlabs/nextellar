/**
 * @jest-environment jsdom
 *
 * ContractCallPreview — full template overlay (#1202)
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import ContractCallPreview, {
  type SimulationPreview,
} from "../../src/templates/full/src/components/ContractCallPreview";

const BASE_PREVIEW: SimulationPreview = {
  result: "ok",
  minResourceFee: "500",
  latestLedger: 9999,
};

describe("ContractCallPreview (full template, #1202)", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<ContractCallPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("announces a loading state", () => {
    render(<ContractCallPreview loading={true} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a simulation error and Cancel", () => {
    const onCancel = jest.fn();
    render(
      <ContractCallPreview
        error={new Error("Simulation failed")}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/simulation failed/i);
    fireEvent.click(screen.getByRole("button", { name: /go back/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders fee, result, and Confirm & Submit when populated", () => {
    const onConfirm = jest.fn();
    render(
      <ContractCallPreview
        preview={BASE_PREVIEW}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("region", { name: /simulation preview/i }),
    ).toBeInTheDocument();
    expect(screen.getByTitle('"ok"')).toHaveTextContent('"ok"');

    fireEvent.click(screen.getByRole("button", { name: /confirm.*submit/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
