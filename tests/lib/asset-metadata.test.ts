import { StellarToml } from "@stellar/stellar-sdk";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { resolveAssetMetadata } from "../../src/templates/default/src/lib/asset-metadata";

describe("asset metadata", () => {
  afterEach(() => {
    clearStellarTomlCache();
    jest.restoreAllMocks();
  });

  it("resolves a matching SEP-1 currency and falls back safely", async () => {
    jest.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
      CURRENCIES: [
        {
          code: "USD",
          issuer: "GISSUER",
          name: "US Dollar",
          image: "https://example.com/usd.png",
          status: "live",
        },
      ],
    } as never);
    await expect(
      resolveAssetMetadata("USD", "GISSUER", "issuer.example"),
    ).resolves.toMatchObject({ name: "US Dollar", verified: true });
    jest
      .spyOn(StellarToml.Resolver, "resolve")
      .mockRejectedValue(new Error("invalid toml"));
    await expect(
      resolveAssetMetadata("EUR", "GISSUER", "issuer.example"),
    ).resolves.toEqual({ code: "EUR", issuer: "GISSUER", verified: false });
  });
});
