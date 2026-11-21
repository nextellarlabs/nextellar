import { jest } from "@jest/globals";
import { StellarToml } from "@stellar/stellar-sdk";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { resolveAssetMetadata } from "../../src/templates/default/src/lib/asset-metadata";

describe("asset metadata", () => {
  afterEach(() => {
    clearStellarTomlCache();
    jest.restoreAllMocks();
  });

  it("resolves a matching SEP-1 currency with name, image, and verified flag", async () => {
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
    ).resolves.toEqual({
      code: "USD",
      issuer: "GISSUER",
      name: "US Dollar",
      image: "https://example.com/usd.png",
      verified: true,
    });
  });

  it("reuses the cached stellar.toml across lookups on the same domain", async () => {
    const resolveSpy = jest
      .spyOn(StellarToml.Resolver, "resolve")
      .mockResolvedValue({
        CURRENCIES: [
          {
            code: "USD",
            issuer: "GISSUER",
            name: "US Dollar",
            image: "https://example.com/usd.png",
            status: "live",
          },
          {
            code: "EUR",
            issuer: "GISSUER",
            name: "Euro",
            image: "https://example.com/eur.png",
            status: "live",
          },
        ],
      } as never);

    const first = await resolveAssetMetadata(
      "USD",
      "GISSUER",
      "issuer.example",
    );
    const second = await resolveAssetMetadata(
      "EUR",
      "GISSUER",
      "ISSUER.EXAMPLE",
    );

    expect(first.name).toBe("US Dollar");
    expect(second.name).toBe("Euro");
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    clearStellarTomlCache();
    await resolveAssetMetadata("USD", "GISSUER", "issuer.example");
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back safely when toml fetch fails or domain is invalid", async () => {
    jest
      .spyOn(StellarToml.Resolver, "resolve")
      .mockRejectedValue(new Error("invalid toml"));

    await expect(
      resolveAssetMetadata("EUR", "GISSUER", "issuer.example"),
    ).resolves.toEqual({ code: "EUR", issuer: "GISSUER", verified: false });

    await expect(
      resolveAssetMetadata("EUR", "GISSUER", "https://not-a-bare-domain.com/"),
    ).resolves.toEqual({ code: "EUR", issuer: "GISSUER", verified: false });
  });

  it("omits missing or non-string icon and name fields instead of throwing", async () => {
    jest.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
      CURRENCIES: [
        {
          code: "USDC",
          issuer: "GISSUER",
          name: 123,
          image: null,
        },
      ],
    } as never);

    await expect(
      resolveAssetMetadata("USDC", "GISSUER", "issuer.example"),
    ).resolves.toEqual({
      code: "USDC",
      issuer: "GISSUER",
      name: undefined,
      image: undefined,
      verified: true,
    });
  });

  it("returns unverified fallback when CURRENCIES is missing or asset does not match", async () => {
    jest.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({
      CURRENCIES: [{ code: "BTC", issuer: "GOTHER", name: "Bitcoin" }],
    } as never);

    await expect(
      resolveAssetMetadata("USDC", "GISSUER", "issuer.example"),
    ).resolves.toEqual({ code: "USDC", issuer: "GISSUER", verified: false });

    clearStellarTomlCache();
    jest.spyOn(StellarToml.Resolver, "resolve").mockResolvedValue({} as never);

    await expect(
      resolveAssetMetadata("USDC", "GISSUER", "issuer.example"),
    ).resolves.toEqual({ code: "USDC", issuer: "GISSUER", verified: false });
  });
});
