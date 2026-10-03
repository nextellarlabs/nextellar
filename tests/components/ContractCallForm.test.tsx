/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SimulateContractCallResult } from "../../src/templates/default/src/hooks/useSorobanContract";
import type { ContractFunctionSpec } from "../../src/templates/default/src/lib/contract-spec";

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// ContractCallForm's own RPC/XDR work is useSorobanContract's and
// fetchContractSpec's responsibility (both already covered by their own unit
// tests) — mocking them here keeps this file focused on the form's own
// behavior (state transitions, the spec-driven dropdown, wiring) without
// spinning up a real Soroban RPC mock server for every test. This is an ESM
// jest setup (see jest.config.mjs), so mocking uses `unstable_mockModule` +
// dynamic imports rather than the CJS `jest.mock` auto-hoisting form (see
// NetworkSwitcher.test.tsx for the established precedent).

const mockSimulateContractCall =
  jest.fn<
    (name: string, args: unknown[]) => Promise<SimulateContractCallResult>
  >();
const mockBuildInvokeXDR =
  jest.fn<(name: string, args: unknown[]) => Promise<string>>();

jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useSorobanContract",
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
  "../../src/templates/default/src/lib/contract-spec",
  () => ({
    fetchContractSpec: (...args: unknown[]) => mockFetchContractSpec(...args),
  }),
);

// ── Dynamic import (must come after unstable_mockModule) ─────────────────────
const { default: ContractCallForm } =
  await import("../../src/templates/default/src/components/ContractCallForm");

const CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

const BASE_PREVIEW: SimulateContractCallResult = {
  result: "ok",
  minResourceFee: "500",
  baseFee: "100",
  latestLedger: 123,
};

describe("ContractCallForm", () => {
  beforeEach(() => {
    mockSimulateContractCall.mockReset();
    mockBuildInvokeXDR.mockReset();
    mockFetchContractSpec.mockReset();
    mockSimulateContractCall.mockResolvedValue(BASE_PREVIEW);
    mockBuildInvokeXDR.mockResolvedValue("AAAAAgAAAAA=");
  });

  // ── Default (free-text) mode ─────────────────────────────────────────────

  describe("free-text function input (default)", () => {
    it("renders a text input for the function name by default", () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      expect(screen.getByLabelText(/function name/i)).toHaveAttribute(
        "type",
        "text",
      );
    });

    it("does not fetch the contract spec unless useContractSpec is set", () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      expect(mockFetchContractSpec).not.toHaveBeenCalled();
    });

    it("disables the Preview button until a function name is entered", () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      expect(screen.getByRole("button", { name: /preview/i })).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });

      expect(
        screen.getByRole("button", { name: /preview/i }),
      ).not.toBeDisabled();
    });

    it("calls simulateContractCall with the parsed args on Preview", async () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });
      fireEvent.change(screen.getByLabelText(/arguments/i), {
        target: { value: "GABC123, 1000, true" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      await waitFor(() =>
        expect(mockSimulateContractCall).toHaveBeenCalledWith("transfer", [
          "GABC123",
          1000,
          true,
        ]),
      );
    });

    it("shows the simulation preview after a successful Preview", async () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "get_value" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      expect(
        await screen.findByRole("region", { name: /simulation preview/i }),
      ).toBeInTheDocument();
    });

    it("calls buildInvokeXDR and onSubmit on Confirm & Submit", async () => {
      const onSubmit = jest.fn<(xdr: string) => void>();
      render(<ContractCallForm contractId={CONTRACT_ID} onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      await screen.findByRole("region", { name: /simulation preview/i });

      fireEvent.click(screen.getByRole("button", { name: /confirm.*submit/i }));

      await waitFor(() =>
        expect(mockBuildInvokeXDR).toHaveBeenCalledWith("transfer", []),
      );
      await waitFor(() =>
        expect(onSubmit).toHaveBeenCalledWith("AAAAAgAAAAA="),
      );
    });

    it("resets the form after a successful submit", async () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      await screen.findByRole("region", { name: /simulation preview/i });

      fireEvent.click(screen.getByRole("button", { name: /confirm.*submit/i }));

      await waitFor(() =>
        expect(screen.getByLabelText(/function name/i)).toHaveValue(""),
      );
    });

    it("surfaces a submit error without resetting the form", async () => {
      mockBuildInvokeXDR.mockRejectedValueOnce(new Error("build failed"));
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      await screen.findByRole("region", { name: /simulation preview/i });

      fireEvent.click(screen.getByRole("button", { name: /confirm.*submit/i }));

      expect(await screen.findByText(/build failed/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/function name/i)).toHaveValue("transfer");
    });

    it("clears the preview when the function name is edited after previewing", async () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer" },
      });
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      await screen.findByRole("region", { name: /simulation preview/i });

      fireEvent.change(screen.getByLabelText(/function name/i), {
        target: { value: "transfer2" },
      });

      expect(
        screen.queryByRole("region", { name: /simulation preview/i }),
      ).toBeNull();
    });
  });

  // ── Spec-driven dropdown (useContractSpec) ───────────────────────────────

  describe("spec-driven function dropdown (useContractSpec)", () => {
    const SPEC_FUNCTIONS: ContractFunctionSpec[] = [
      {
        name: "transfer",
        args: [
          { name: "to", type: "Address" },
          { name: "amount", type: "i128" },
        ],
        outputsCount: 0,
        doc: "",
      },
      { name: "get_admin", args: [], outputsCount: 1, doc: "" },
    ];

    it("fetches the contract spec on mount when useContractSpec is true", async () => {
      mockFetchContractSpec.mockResolvedValue({ functions: SPEC_FUNCTIONS });
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      await waitFor(() =>
        expect(mockFetchContractSpec).toHaveBeenCalledTimes(1),
      );
    });

    it("renders a <select> populated with the spec functions once loaded", async () => {
      mockFetchContractSpec.mockResolvedValue({ functions: SPEC_FUNCTIONS });
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      await waitFor(() =>
        expect(screen.getByLabelText(/function name/i).tagName).toBe("SELECT"),
      );
      expect(
        screen.getByRole("option", { name: /transfer/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: /get_admin/i }),
      ).toBeInTheDocument();
    });

    it("selecting a function from the dropdown enables Preview", async () => {
      mockFetchContractSpec.mockResolvedValue({ functions: SPEC_FUNCTIONS });
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      await waitFor(() =>
        expect(screen.getByLabelText(/function name/i).tagName).toBe("SELECT"),
      );
      const select = screen.getByLabelText(/function name/i);
      fireEvent.change(select, { target: { value: "get_admin" } });

      expect(
        screen.getByRole("button", { name: /preview/i }),
      ).not.toBeDisabled();
    });

    it("falls back to the free-text input when the spec fetch fails", async () => {
      mockFetchContractSpec.mockRejectedValue(new Error("no spec section"));
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      await waitFor(() => expect(mockFetchContractSpec).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByLabelText(/function name/i)).toHaveAttribute(
          "type",
          "text",
        ),
      );
    });

    it("falls back to the free-text input when the spec has no functions", async () => {
      mockFetchContractSpec.mockResolvedValue({ functions: [] });
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      await waitFor(() => expect(mockFetchContractSpec).toHaveBeenCalled());
      expect(screen.getByLabelText(/function name/i)).toHaveAttribute(
        "type",
        "text",
      );
    });

    it("does not render the dropdown while the spec is still loading", () => {
      mockFetchContractSpec.mockReturnValue(new Promise(() => {})); // never resolves
      render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);

      expect(screen.getByLabelText(/function name/i).tagName).toBe("INPUT");
      expect(
        screen.getByPlaceholderText(/loading contract functions/i),
      ).toBeInTheDocument();
    });

    it("re-fetches the spec when contractId changes", async () => {
      mockFetchContractSpec.mockResolvedValue({ functions: SPEC_FUNCTIONS });
      const { rerender } = render(
        <ContractCallForm contractId={CONTRACT_ID} useContractSpec />,
      );
      await waitFor(() =>
        expect(mockFetchContractSpec).toHaveBeenCalledTimes(1),
      );

      const otherContractId =
        "CBBQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC527";
      rerender(
        <ContractCallForm contractId={otherContractId} useContractSpec />,
      );

      await waitFor(() =>
        expect(mockFetchContractSpec).toHaveBeenCalledTimes(2),
      );
    });
  });
});
