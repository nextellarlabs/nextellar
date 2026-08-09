import {
  refreshAssetDirectory,
  searchAssetDirectory,
} from "../../lib/assetDirectory.js";

describe("assetDirectory search helpers", () => {
  beforeEach(() => {
    refreshAssetDirectory(true);
  });

  it("returns exact matches case-insensitively", () => {
    const results = searchAssetDirectory("usdc");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].code).toBe("USDC");
  });

  it("returns partial matches for a shared prefix", () => {
    const results = searchAssetDirectory("usd");

    expect(results.some((asset) => asset.code === "USDC")).toBe(true);
    expect(results.some((asset) => asset.code === "USDT")).toBe(true);
  });

  it("returns an empty list for unknown assets", () => {
    const results = searchAssetDirectory("definitely-not-an-asset");

    expect(results).toEqual([]);
  });
});
