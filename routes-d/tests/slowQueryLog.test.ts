import { withSlowQueryLogging } from "../lib/slowQueryLog.js";

describe("withSlowQueryLogging", () => {
  it("does not log fast queries", async () => {
    const log = jest.fn();
    const now = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10);

    const result = await withSlowQueryLogging(
      "horizon",
      async () => "ok",
      { thresholdMs: 50, log, now },
    );

    expect(result).toBe("ok");
    expect(log).not.toHaveBeenCalled();
  });

  it("logs slow queries with the target and duration", async () => {
    const log = jest.fn();
    const now = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(75);

    await withSlowQueryLogging(
      "soroban",
      async () => "ok",
      { thresholdMs: 50, log, now },
    );

    expect(log).toHaveBeenCalledWith({ target: "soroban", durationMs: 75 });
  });

  it("logs slow failures and rethrows the original error", async () => {
    const log = jest.fn();
    const now = jest.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(100);

    await expect(
      withSlowQueryLogging(
        "database",
        async () => {
          throw new Error("boom");
        },
        { thresholdMs: 50, log, now },
      ),
    ).rejects.toThrow("boom");

    expect(log).toHaveBeenCalledWith({ target: "database", durationMs: 100, error: "boom" });
  });
});
