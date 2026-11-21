/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { rpc, xdr, contract } from "@stellar/stellar-sdk";
import type { SimulateContractCallResult } from "../../src/templates/default/src/hooks/useSorobanContract";
import { VALID_CONTRACT_ID } from "../helpers";

const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

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

// Intentionally import the real ContractCallForm without mocking lib/contract-spec
// so this test exercises the full fetchContractSpec -> ContractCallForm round trip.
const { default: ContractCallForm } =
  await import("../../src/templates/default/src/components/ContractCallForm");

describe("ContractCallForm + fetchContractSpec round-trip (#1514)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    mockSimulateContractCall.mockReset();
    mockBuildInvokeXDR.mockReset();
    mockSimulateContractCall.mockResolvedValue({
      result: "ok",
      minResourceFee: "500",
      baseFee: "100",
      latestLedger: 123,
    });
    mockBuildInvokeXDR.mockResolvedValue("AAAAAgAAAAA=");
  });

  it("populates function dropdown and typed argument fields from real XDR contract.Spec", async () => {
    const spec = new contract.Spec([
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({
          doc: "Transfer tokens",
          name: "transfer",
          inputs: [
            new xdr.ScSpecFunctionInputV0({
              doc: "",
              name: "to",
              type: xdr.ScSpecTypeDef.scSpecTypeAddress(),
            }),
            new xdr.ScSpecFunctionInputV0({
              doc: "",
              name: "amount",
              type: xdr.ScSpecTypeDef.scSpecTypeU128(),
            }),
            new xdr.ScSpecFunctionInputV0({
              doc: "",
              name: "memo",
              type: xdr.ScSpecTypeDef.scSpecTypeSymbol(),
            }),
          ],
          outputs: [],
        }),
      ),
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({
          doc: "",
          name: "ping",
          inputs: [],
          outputs: [xdr.ScSpecTypeDef.scSpecTypeBool()],
        }),
      ),
    ]);

    jest
      .spyOn(rpc.Server.prototype, "getContractWasmByContractId")
      .mockResolvedValue(Buffer.from([0, 1, 2, 3]) as never);
    jest
      .spyOn(contract.Client, "fromWasm")
      .mockResolvedValue({ spec } as never);

    render(<ContractCallForm contractId={VALID_CONTRACT_ID} useContractSpec />);

    await waitFor(() =>
      expect(screen.getByLabelText(/function name/i).tagName).toBe("SELECT"),
    );

    const select = screen.getByLabelText(/function name/i);
    expect(
      screen.getByRole("option", {
        name: "transfer (to: Address, amount: u128, memo: Symbol)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ping ()" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "transfer" } });

    fireEvent.change(screen.getByLabelText(/to \(Address\)/i), {
      target: { value: ACCOUNT },
    });
    fireEvent.change(screen.getByLabelText(/amount \(u128\)/i), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText(/memo \(Symbol\)/i), {
      target: { value: "hello" },
    });

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() =>
      expect(mockSimulateContractCall).toHaveBeenCalledWith("transfer", [
        ACCOUNT,
        500,
        "hello",
      ]),
    );
    expect(
      await screen.findByRole("region", { name: /simulation preview/i }),
    ).toBeInTheDocument();
  });
});
