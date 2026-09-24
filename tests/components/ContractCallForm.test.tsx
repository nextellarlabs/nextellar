/**
 * @jest-environment jsdom
 *
 * ContractCallForm Component Tests
 *
 * Covers function/argument input, preview-button validation, argument
 * parsing, and the simulate-then-submit flow against a mocked
 * `useSorobanContract` hook (real `ContractCallPreview` UI).
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import React from "react";

// ── Mock useSorobanContract ───────────────────────────────────────────────────

jest.unstable_mockModule(
  "../../src/templates/default/src/hooks/useSorobanContract",
  () => ({
    useSorobanContract: jest.fn(),
    isValidContractId: jest.fn(() => true),
  }),
);

const [{ default: ContractCallForm }, { useSorobanContract }] =
  await Promise.all([
    import("../../src/templates/default/src/components/ContractCallForm"),
    import("../../src/templates/default/src/hooks/useSorobanContract"),
  ]);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONTRACT_ID =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

const SIM_RESULT = {
  result: "ok",
  minResourceFee: "500",
  latestLedger: 9999,
};

const UNSIGNED_XDR = "AAAAAgAAAABfake-unsigned-xdr";

type HookState = {
  simulateContractCall: jest.Mock;
  buildInvokeXDR: jest.Mock;
  callFunction: jest.Mock;
  submitInvokeWithSecret: jest.Mock;
  loading: boolean;
  error: Error | null;
};

function mockHook(partial: Partial<HookState> = {}): HookState {
  const state: HookState = {
    simulateContractCall: jest
      .fn<() => Promise<typeof SIM_RESULT>>()
      .mockResolvedValue(SIM_RESULT),
    buildInvokeXDR: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue(UNSIGNED_XDR),
    callFunction: jest.fn(),
    submitInvokeWithSecret: jest.fn(),
    loading: false,
    error: null,
    ...partial,
  };
  (useSorobanContract as unknown as jest.Mock).mockReturnValue(state);
  return state;
}

function getFnInput() {
  return screen.getByLabelText(/function name/i);
}

function getArgsInput() {
  return screen.getByLabelText(/arguments/i);
}

function getPreviewButton() {
  return screen.getByRole("button", { name: /^preview$|^simulating/i });
}

async function fillAndPreview(
  fnName: string,
  args = "",
): Promise<ReturnType<typeof mockHook>> {
  const hook = mockHook();
  render(<ContractCallForm contractId={CONTRACT_ID} />);
  fireEvent.change(getFnInput(), { target: { value: fnName } });
  if (args) {
    fireEvent.change(getArgsInput(), { target: { value: args } });
  }
  fireEvent.click(getPreviewButton());
  await waitFor(() => {
    expect(hook.simulateContractCall).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /confirm.*submit/i }),
    ).toBeInTheDocument();
  });
  return hook;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ContractCallForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the heading, function and arguments fields, and Preview button", () => {
      mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      expect(
        screen.getByRole("heading", { name: /call contract function/i }),
      ).toBeInTheDocument();
      expect(getFnInput()).toBeInTheDocument();
      expect(getArgsInput()).toBeInTheDocument();
      expect(getPreviewButton()).toBeInTheDocument();
    });

    it("passes options into useSorobanContract", () => {
      mockHook();
      render(
        <ContractCallForm
          contractId={CONTRACT_ID}
          sorobanRpc="https://rpc.test"
          network="PUBLIC"
          className="extra-class"
        />,
      );

      expect(useSorobanContract).toHaveBeenCalledWith({
        contractId: CONTRACT_ID,
        sorobanRpc: "https://rpc.test",
        network: "PUBLIC",
      });
      expect(document.querySelector(".extra-class")).not.toBeNull();
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe("validation", () => {
    it("disables Preview when the function name is empty", () => {
      mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      expect(getPreviewButton()).toBeDisabled();
    });

    it("disables Preview when the function name is only whitespace", () => {
      mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(getFnInput(), { target: { value: "   " } });
      expect(getPreviewButton()).toBeDisabled();
    });

    it("enables Preview once a non-empty function name is entered", () => {
      mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      expect(getPreviewButton()).not.toBeDisabled();
    });

    it("disables Preview while the hook reports loading", () => {
      mockHook({ loading: true });
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      expect(getPreviewButton()).toBeDisabled();
      expect(screen.getByRole("button", { name: /simulating/i })).toBeInTheDocument();
    });
  });

  // ── Function / argument input ─────────────────────────────────────────────

  describe("function and argument input", () => {
    it("accepts function name and argument text", () => {
      mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      fireEvent.change(getArgsInput(), {
        target: { value: "GABC, 1000, true" },
      });

      expect(getFnInput()).toHaveValue("transfer");
      expect(getArgsInput()).toHaveValue("GABC, 1000, true");
    });

    it("clears an existing preview when the function name changes", async () => {
      await fillAndPreview("transfer");
      expect(
        screen.getByRole("region", { name: /simulation preview/i }),
      ).toBeInTheDocument();

      fireEvent.change(getFnInput(), { target: { value: "balance" } });

      expect(
        screen.queryByRole("region", { name: /simulation preview/i }),
      ).toBeNull();
      expect(getPreviewButton()).toBeInTheDocument();
    });

    it("clears an existing preview when arguments change", async () => {
      await fillAndPreview("transfer", "1");
      fireEvent.change(getArgsInput(), { target: { value: "2" } });

      expect(
        screen.queryByRole("region", { name: /simulation preview/i }),
      ).toBeNull();
    });
  });

  // ── Argument parsing ──────────────────────────────────────────────────────

  describe("argument parsing", () => {
    it("passes an empty args array when arguments are blank", async () => {
      const hook = await fillAndPreview("noop");
      expect(hook.simulateContractCall).toHaveBeenCalledWith("noop", []);
    });

    it("coerces booleans, integers, and strings", async () => {
      const hook = await fillAndPreview(
        "transfer",
        "GABC123, 1000, true, false, hello, 3.14",
      );
      expect(hook.simulateContractCall).toHaveBeenCalledWith("transfer", [
        "GABC123",
        1000,
        true,
        false,
        "hello",
        "3.14",
      ]);
    });

    it("trims whitespace around tokens and the function name", async () => {
      const hook = mockHook();
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(getFnInput(), { target: { value: "  mint  " } });
      fireEvent.change(getArgsInput(), {
        target: { value: "  alice ,  42  " },
      });
      fireEvent.click(getPreviewButton());
      await waitFor(() => {
        expect(hook.simulateContractCall).toHaveBeenCalledWith("mint", [
          "alice",
          42,
        ]);
      });
    });
  });

  // ── Simulate-then-submit flow ─────────────────────────────────────────────

  describe("simulate-then-submit flow", () => {
    it("runs simulateContractCall on Preview and shows the preview panel", async () => {
      const hook = await fillAndPreview("transfer", "1000, true");

      expect(hook.simulateContractCall).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("region", { name: /simulation preview/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("500")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /confirm.*submit/i }),
      ).toBeInTheDocument();
      // Preview button is hidden once a preview is showing
      expect(
        screen.queryByRole("button", { name: /^preview$/i }),
      ).toBeNull();
    });

    it("builds XDR and calls onSubmit when Confirm & Submit is clicked", async () => {
      const onSubmit = jest
        .fn<(xdr: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const hook = mockHook();
      render(
        <ContractCallForm contractId={CONTRACT_ID} onSubmit={onSubmit} />,
      );

      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      fireEvent.change(getArgsInput(), {
        target: { value: "GDEST, 50" },
      });
      fireEvent.click(getPreviewButton());
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /confirm.*submit/i }),
        ).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getByRole("button", { name: /confirm.*submit/i }),
      );

      await waitFor(() => {
        expect(hook.buildInvokeXDR).toHaveBeenCalledWith("transfer", [
          "GDEST",
          50,
        ]);
        expect(onSubmit).toHaveBeenCalledWith(UNSIGNED_XDR);
      });

      // Form resets after successful submit
      await waitFor(() => {
        expect(getFnInput()).toHaveValue("");
        expect(getArgsInput()).toHaveValue("");
        expect(
          screen.queryByRole("region", { name: /simulation preview/i }),
        ).toBeNull();
      });
    });

    it("logs XDR to console when onSubmit is omitted", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const hook = await fillAndPreview("ping");

      fireEvent.click(
        screen.getByRole("button", { name: /confirm.*submit/i }),
      );

      await waitFor(() => {
        expect(hook.buildInvokeXDR).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(
          "[ContractCallForm] Unsigned XDR:",
          UNSIGNED_XDR,
        );
      });
      logSpy.mockRestore();
    });

    it("Cancel dismisses the preview and restores the Preview button", async () => {
      await fillAndPreview("transfer");
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(
        screen.queryByRole("region", { name: /simulation preview/i }),
      ).toBeNull();
      expect(getPreviewButton()).toBeInTheDocument();
    });

    it("shows a submit error from buildInvokeXDR and allows Go back", async () => {
      const hook = mockHook({
        buildInvokeXDR: jest
          .fn<() => Promise<string>>()
          .mockRejectedValue(new Error("XDR build failed")),
      });
      render(<ContractCallForm contractId={CONTRACT_ID} />);
      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      fireEvent.click(getPreviewButton());
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /confirm.*submit/i }),
        ).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getByRole("button", { name: /confirm.*submit/i }),
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(/XDR build failed/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /go back/i }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(hook.buildInvokeXDR).toHaveBeenCalled();
    });

    it("surfaces hook-level simulation errors via ContractCallPreview", () => {
      mockHook({
        error: new Error("Simulation failed: contract reverted"),
      });
      render(<ContractCallForm contractId={CONTRACT_ID} />);

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(
        screen.getByText(/contract reverted/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /go back/i }),
      ).toBeInTheDocument();
    });

    it("shows Building transaction… while submit is in flight", async () => {
      let resolveBuild!: (v: string) => void;
      const hook = mockHook({
        buildInvokeXDR: jest.fn<() => Promise<string>>(
          () =>
            new Promise<string>((resolve) => {
              resolveBuild = resolve;
            }),
        ),
      });
      const onSubmit = jest.fn();
      render(
        <ContractCallForm contractId={CONTRACT_ID} onSubmit={onSubmit} />,
      );
      fireEvent.change(getFnInput(), { target: { value: "transfer" } });
      fireEvent.click(getPreviewButton());
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /confirm.*submit/i }),
        ).toBeInTheDocument();
      });

      fireEvent.click(
        screen.getByRole("button", { name: /confirm.*submit/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("status", { name: /building transaction/i }),
        ).toBeInTheDocument();
      });

      resolveBuild(UNSIGNED_XDR);
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(UNSIGNED_XDR);
        expect(hook.buildInvokeXDR).toHaveBeenCalled();
      });
    });
  });
});
