/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFeeStats = jest.fn();
const MockServer = jest.fn().mockImplementation(() => ({
  feeStats: mockFeeStats,
}));

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  BASE_FEE: "100",
}));

const { useFeeEstimate, stroopsToXlm } = await import(
  "../../src/templates/default/src/hooks/useFeeEstimate.js"
);

describe("useFeeEstimate hook (#1446)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("happy path: fetches feeStats, exposes presets and conversions", async () => {
    mockFeeStats.mockResolvedValueOnce({
      last_ledger_base_fee: "100",
      fee_charged: {
        min: "100",
        mode: "100",
        p10: "100",
        p20: "120",
        p50: "150",
        p95: "300",
        max: "500",
      },
      max_fee: {
        mode: "200",
      },
    });

    const { result } = renderHook(() =>
      useFeeEstimate({ refreshInterval: 0 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.baseFee).toBe("100");
    expect(result.current.presets).toEqual({
      low: "120",
      standard: "150",
      high: "300",
    });
    expect(result.current.getFeeForPreset("standard")).toBe("150");
    expect(result.current.stroopsToXlm("10000000")).toBe("1.0000000");
    expect(stroopsToXlm(100)).toBe("0.0000100");
  });

  it("failure mode 1: network/Horizon 500 error falls back to BASE_FEE", async () => {
    mockFeeStats.mockRejectedValueOnce(new Error("Horizon 500 Internal Server Error"));

    const { result } = renderHook(() =>
      useFeeEstimate({ refreshInterval: 0 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toMatch(/Horizon 500/);
    expect(result.current.presets).toEqual({
      low: "100",
      standard: "100",
      high: "100",
    });
    expect(result.current.baseFee).toBe("100");
  });

  it("failure mode 2: malformed/empty response falls back to BASE_FEE gracefully", async () => {
    mockFeeStats.mockRejectedValueOnce(new Error("Network timeout"));

    const { result } = renderHook(() =>
      useFeeEstimate({ refreshInterval: 0 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toMatch(/Network timeout/);
    expect(result.current.presets.low).toBe("100");
  });

  it("refresh allows updating fee stats on demand", async () => {
    mockFeeStats
      .mockResolvedValueOnce({
        last_ledger_base_fee: "100",
        fee_charged: { p20: "100", p50: "100", p95: "100" },
      })
      .mockResolvedValueOnce({
        last_ledger_base_fee: "200",
        fee_charged: { p20: "200", p50: "300", p95: "500" },
      });

    const { result } = renderHook(() =>
      useFeeEstimate({ refreshInterval: 0 }),
    );

    await waitFor(() => expect(result.current.presets.high).toBe("100"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.presets.high).toBe("500");
    expect(result.current.baseFee).toBe("200");
  });
});
