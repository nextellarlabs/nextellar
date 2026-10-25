/**
 * @jest-environment jsdom
 *
 * ContractCallForm field-level error announcements (#1144).
 *
 * Every invalid field must expose its error to assistive tech: the input is
 * marked aria-invalid and points at the message via aria-describedby, and
 * the message is announced (role="alert"). Invalid input never reaches the
 * simulation.
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SimulateContractCallResult } from "../../src/templates/default/src/hooks/useSorobanContract";
import type { ContractFunctionSpec } from "../../src/templates/default/src/lib/contract-spec";

const mockSimulateContractCall =
  jest.fn<(name: string, args: unknown[]) => Promise<SimulateContractCallResult>>();
const mockBuildInvokeXDR = jest.fn<(name: string, args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("../../src/templates/default/src/hooks/useSorobanContract", () => ({
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
}));

const mockFetchContractSpec =
  jest.fn<(...args: unknown[]) => Promise<{ functions: ContractFunctionSpec[] }>>();

jest.unstable_mockModule("../../src/templates/default/src/lib/contract-spec", () => ({
  fetchContractSpec: (...args: unknown[]) => mockFetchContractSpec(...args),
}));

const { default: ContractCallForm, validateArgValue, validateFunctionName } = await import(
  "../../src/templates/default/src/components/ContractCallForm"
);

const CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const SPEC_FUNCTIONS: ContractFunctionSpec[] = [
  {
    name: "transfer",
    args: [
      { name: "to", type: "Address" },
      { name: "amount", type: "i128" },
      { name: "memo", type: "Symbol" },
    ],
    outputsCount: 0,
    doc: "",
  },
  { name: "set_flag", args: [{ name: "enabled", type: "bool" }], outputsCount: 0, doc: "" },
  { name: "get_admin", args: [], outputsCount: 1, doc: "" },
];

/** The error element an input points at through aria-describedby. */
function describedError(input: HTMLElement): HTMLElement | null {
  const ids = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el?.getAttribute("role") === "alert") return el;
  }
  return null;
}

function expectAnnouncedError(input: HTMLElement, message: RegExp) {
  expect(input).toHaveAttribute("aria-invalid", "true");
  const error = describedError(input);
  expect(error).not.toBeNull();
  expect(error).toHaveAttribute("role", "alert");
  expect(error).toHaveTextContent(message);
  expect(input).toHaveAccessibleDescription(message);
}

function expectNoError(input: HTMLElement) {
  expect(input).not.toHaveAttribute("aria-invalid");
  expect(describedError(input)).toBeNull();
}

async function renderWithSpec() {
  mockFetchContractSpec.mockResolvedValue({ functions: SPEC_FUNCTIONS });
  render(<ContractCallForm contractId={CONTRACT_ID} useContractSpec />);
  await waitFor(() => expect(screen.getByLabelText(/function name/i).tagName).toBe("SELECT"));
}

const preview = () => fireEvent.click(screen.getByRole("button", { name: /preview/i }));

describe("ContractCallForm field-level errors (#1144)", () => {
  beforeEach(() => {
    mockSimulateContractCall.mockReset();
    mockBuildInvokeXDR.mockReset();
    mockFetchContractSpec.mockReset();
    mockSimulateContractCall.mockResolvedValue({
      result: "ok",
      minResourceFee: "500",
      baseFee: "100",
      latestLedger: 1,
    });
    mockBuildInvokeXDR.mockResolvedValue("AAAA");
  });

  describe("spec-driven per-argument fields", () => {
    it("renders one labelled field per argument of the selected function", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });

      expect(screen.getByLabelText(/^to/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^amount/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^memo/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/comma-separated/i)).toBeNull();
    });

    it("associates and announces an error on each invalid argument field", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });

      fireEvent.change(screen.getByLabelText(/^to/), { target: { value: "not-an-address" } });
      fireEvent.change(screen.getByLabelText(/^amount/), { target: { value: "12.5" } });
      // memo left empty
      preview();

      expectAnnouncedError(screen.getByLabelText(/^to/), /Stellar address/);
      expectAnnouncedError(screen.getByLabelText(/^amount/), /whole number/);
      expectAnnouncedError(screen.getByLabelText(/^memo/), /required/);
      expect(mockSimulateContractCall).not.toHaveBeenCalled();
    });

    it("gives every error a unique id so each field points at its own message", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });
      preview();

      const ids = [/^to/, /^amount/, /^memo/].map((label) => describedError(screen.getByLabelText(label))?.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("moves focus to the first invalid field", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });
      fireEvent.change(screen.getByLabelText(/^to/), { target: { value: ACCOUNT } });
      preview();

      expect(screen.getByLabelText(/^amount/)).toHaveFocus();
    });

    it("leaves valid fields unmarked", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });
      fireEvent.change(screen.getByLabelText(/^to/), { target: { value: ACCOUNT } });
      preview();

      expectNoError(screen.getByLabelText(/^to/));
      expectAnnouncedError(screen.getByLabelText(/^amount/), /required/);
    });

    it("clears a field's error as soon as it is edited", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "set_flag" } });
      fireEvent.change(screen.getByLabelText(/^enabled/), { target: { value: "yes" } });
      preview();
      expectAnnouncedError(screen.getByLabelText(/^enabled/), /true or false/);

      fireEvent.change(screen.getByLabelText(/^enabled/), { target: { value: "true" } });

      expectNoError(screen.getByLabelText(/^enabled/));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("simulates with typed values once every field is valid", async () => {
      await renderWithSpec();
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });
      fireEvent.change(screen.getByLabelText(/^to/), { target: { value: ACCOUNT } });
      fireEvent.change(screen.getByLabelText(/^amount/), {
        target: { value: "170141183460469231731687303715884105727" },
      });
      fireEvent.change(screen.getByLabelText(/^memo/), { target: { value: "rent_oct" } });
      preview();

      await waitFor(() =>
        expect(mockSimulateContractCall).toHaveBeenCalledWith("transfer", [
          ACCOUNT,
          BigInt("170141183460469231731687303715884105727"),
          "rent_oct",
        ]),
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("drops argument errors when a different function is selected", async () => {
      await renderWithSpec();
      const fn = screen.getByLabelText(/function name/i);
      fireEvent.change(fn, { target: { value: "transfer" } });
      preview();
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

      fireEvent.change(fn, { target: { value: "get_admin" } });

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("free-text mode", () => {
    it("announces an empty comma-separated argument on the arguments field", () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(screen.getByLabelText(/function name/i), { target: { value: "transfer" } });
      const args = screen.getByLabelText(/arguments/i);
      fireEvent.change(args, { target: { value: "GABC,,1000" } });
      preview();

      expectAnnouncedError(args, /Argument 2 is empty/);
      // The usage hint stays in the description alongside the error.
      expect(args.getAttribute("aria-describedby")).toContain("ccf-args-hint");
      expect(mockSimulateContractCall).not.toHaveBeenCalled();
    });

    it("announces an invalid function name on the function field", () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      const fn = screen.getByLabelText(/function name/i);
      fireEvent.change(fn, { target: { value: "do-transfer!" } });
      preview();

      expectAnnouncedError(fn, /letters, numbers and underscores/);
      expect(fn).toHaveFocus();
      expect(mockSimulateContractCall).not.toHaveBeenCalled();
    });

    it("does not mark fields invalid for a valid call", async () => {
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      const fn = screen.getByLabelText(/function name/i);
      fireEvent.change(fn, { target: { value: "transfer" } });
      fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: "GABC, 1000" } });
      preview();

      await waitFor(() => expect(mockSimulateContractCall).toHaveBeenCalled());
      expectNoError(fn);
      expectNoError(screen.getByLabelText(/arguments/i));
    });
  });
});

describe("validateArgValue", () => {
  it.each([
    ["true", "bool"],
    ["4294967295", "u32"],
    ["-2147483648", "i32"],
    ["-170141183460469231731687303715884105728", "i128"],
    [ACCOUNT, "Address"],
    [CONTRACT_ID, "Address"],
    ["hello_world", "Symbol"],
    ["any text", "String"],
    ["deadbeef", "Bytes"],
  ])("accepts %s as %s", (value, type) => {
    expect(validateArgValue(value, type)).toBeNull();
  });

  it.each([
    ["", "String", /required/],
    ["   ", "u32", /required/],
    ["yes", "bool", /true or false/],
    ["-1", "u64", /whole number/],
    ["4294967296", "u32", /out of range/],
    ["1e5", "i64", /whole number/],
    ["GSHORT", "Address", /Stellar address/],
    ["has space", "Symbol", /letters, numbers and underscores/],
  ])("rejects %j as %s", (value, type, message) => {
    expect(validateArgValue(value, type)).toMatch(message);
  });
});

describe("validateFunctionName", () => {
  it("accepts Soroban symbols and rejects anything else", () => {
    expect(validateFunctionName("transfer")).toBeNull();
    expect(validateFunctionName("")).toMatch(/Enter a function name/);
    expect(validateFunctionName("a".repeat(33))).toMatch(/max 32/);
    expect(validateFunctionName("bad-name")).toMatch(/letters/);
  });
});
