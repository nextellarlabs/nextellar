/**
 * @jest-environment jsdom
 *
 * ContractCallForm — full template overlay (#1202)
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SimulateContractCallResult } from "../../src/templates/full/src/hooks/useSorobanContract";
import type { ContractFunctionSpec } from "../../src/templates/full/src/lib/contract-spec";

const mockSimulateContractCall =
  jest.fn<
    (name: string, args: unknown[]) => Promise<SimulateContractCallResult>
  >();
const mockBuildInvokeXDR =
  jest.fn<(name: string, args: unknown[]) => Promise<string>>();

jest.unstable_mockModule(
  "../../src/templates/full/src/hooks/useSorobanContract",
  () => ({
    useSorobanContract: () => ({
      simulateContractCall: mockSimulateContractCall,
      buildInvokeXDR: mockBuildInvokeXDR,
      callFunction: jest.fn(),
      simulateBatchContractCall: jest.fn(),
      buildBatchInvokeXDRs: jest.fn(),
      submitInvokeWithSecret: jest.fn(),
      loading: false,
      error: null,
    }),
  }),
);

const mockFetchContractSpec =
  jest.fn<
    (...args: unknown[]) => Promise<{ functions: ContractFunctionSpec[] }>
  >();

jest.unstable_mockModule(
  "../../src/templates/full/src/lib/contract-spec",
  () => ({
    fetchContractSpec: (...args: unknown[]) => mockFetchContractSpec(...args),
  }),
);

const { default: ContractCallForm } =
  await import("../../src/templates/full/src/components/ContractCallForm");

const CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

const BASE_PREVIEW: SimulateContractCallResult = {
  result: "ok",
  minResourceFee: "500",
  baseFee: "100",
  latestLedger: 123,
};

describe("ContractCallForm (full template, #1202)", () => {
  beforeEach(() => {
    mockSimulateContractCall.mockReset();
    mockBuildInvokeXDR.mockReset();
    mockFetchContractSpec.mockReset();
    mockSimulateContractCall.mockResolvedValue(BASE_PREVIEW);
    mockBuildInvokeXDR.mockResolvedValue("AAAAAgAAAAA=");
  });

  it("renders a free-text function input and a disabled Preview button", () => {
    render(<ContractCallForm contractId={CONTRACT_ID} />);
    expect(screen.getByLabelText(/function name/i)).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByRole("button", { name: /preview/i })).toBeDisabled();
  });

  it("simulates on Preview and shows the preview region", async () => {
    render(<ContractCallForm contractId={CONTRACT_ID} />);

    fireEvent.change(screen.getByLabelText(/function name/i), {
      target: { value: "transfer" },
    });
    fireEvent.change(screen.getByLabelText(/arguments/i), {
      target: { value: "GABC123, 1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() =>
      expect(mockSimulateContractCall).toHaveBeenCalledWith("transfer", [
        "GABC123",
        1000,
      ]),
    );
    expect(
      await screen.findByRole("region", { name: /simulation preview/i }),
    ).toBeInTheDocument();
  });

  it("builds XDR and calls onSubmit on Confirm & Submit", async () => {
    const onSubmit = jest.fn<(xdr: string) => void>();
    render(<ContractCallForm contractId={CONTRACT_ID} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/function name/i), {
      target: { value: "increment" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await screen.findByRole("region", { name: /simulation preview/i });

    fireEvent.click(screen.getByRole("button", { name: /confirm.*submit/i }));

    await waitFor(() =>
      expect(mockBuildInvokeXDR).toHaveBeenCalledWith("increment", []),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("AAAAAgAAAAA="));
  });

  it("fetches the contract spec when useContractSpec is set", async () => {
    mockFetchContractSpec.mockResolvedValue({
      functions: [
        { name: "increment", args: [], outputsCount: 1, doc: "" },
        { name: "get_count", args: [], outputsCount: 1, doc: "" },
      ],
    });

    render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

    await waitFor(() =>
      expect(screen.getByLabelText(/function name/i).tagName).toBe("SELECT"),
    );
    expect(mockFetchContractSpec).toHaveBeenCalled();
    expect(
      screen.getByRole("option", { name: /increment/i }),
    ).toBeInTheDocument();
  });
});
