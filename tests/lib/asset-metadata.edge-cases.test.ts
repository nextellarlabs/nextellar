import { StellarToml } from "@stellar/stellar-sdk";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { resolveAssetMetadata } from "../../src/templates/default/src/lib/asset-metadata";

const ISSUER = "GISSUER";
const OTHER_ISSUER = "GOTHERISSUER";

function mockToml(toml: unknown) {
  return jest
    .spyOn(StellarToml.Resolver, "resolve")
    .mockResolvedValue(toml as never);
}

describe("resolveAssetMetadata: stellar.toml fetch", () => {
  afterEach(() => {
    clearStellarTomlCache();
    jest.restoreAllMocks();
  });

  it("returns the name, image and verified flag for a matching currency", async () => {
    mockToml({
      CURRENCIES: [
        {
          code: "USD",
          issuer: ISSUER,
          name: "US Dollar",
          image: "https://x.test/usd.png",
          status: "live",
        },
      ],
    });

    await expect(
      resolveAssetMetadata("USD", ISSUER, "issuer.example"),
    ).resolves.toEqual({
      code: "USD",
      issuer: ISSUER,
      name: "US Dollar",
      image: "https://x.test/usd.png",
      verified: true,
    });
  });

  it("picks the right entry among several currencies by code and issuer", async () => {
    mockToml({
      CURRENCIES: [
        { code: "USD", issuer: OTHER_ISSUER, name: "Wrong issuer" },
        { code: "EUR", issuer: ISSUER, name: "Wrong code" },
        { code: "USD", issuer: ISSUER, name: "Right one" },
      ],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.name).toBe("Right one");
  });

  it("requests the toml for the domain it was given", async () => {
    const resolve = mockToml({ CURRENCIES: [] });

    await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(resolve).toHaveBeenCalledWith("issuer.example", expect.anything());
  });

  it("falls back to code and issuer when the fetch fails", async () => {
    jest
      .spyOn(StellarToml.Resolver, "resolve")
      .mockRejectedValue(new Error("network down"));

    await expect(
      resolveAssetMetadata("USD", ISSUER, "issuer.example"),
    ).resolves.toEqual({
      code: "USD",
      issuer: ISSUER,
      verified: false,
    });
  });

  it("does not throw for a malformed toml response", async () => {
    mockToml(null);

    await expect(
      resolveAssetMetadata("USD", ISSUER, "issuer.example"),
    ).resolves.toEqual({
      code: "USD",
      issuer: ISSUER,
      verified: false,
    });
  });

  it.each(["https://issuer.example", "issuer.example/path", "", "no_dot"])(
    "falls back without any network request for the invalid domain %j",
    async (domain) => {
      const resolve = jest.spyOn(StellarToml.Resolver, "resolve");

      const result = await resolveAssetMetadata("USD", ISSUER, domain);

      expect(result).toEqual({ code: "USD", issuer: ISSUER, verified: false });
      expect(resolve).not.toHaveBeenCalled();
    },
  );
});

describe("resolveAssetMetadata: caching", () => {
  afterEach(() => {
    clearStellarTomlCache();
    jest.restoreAllMocks();
  });

  it("fetches the toml once for repeated lookups on the same domain", async () => {
    const resolve = mockToml({
      CURRENCIES: [{ code: "USD", issuer: ISSUER, name: "US Dollar" }],
    });

    await resolveAssetMetadata("USD", ISSUER, "issuer.example");
    await resolveAssetMetadata("USD", ISSUER, "issuer.example");
    await resolveAssetMetadata("USD", ISSUER, "ISSUER.example");

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("fetches separately for different domains", async () => {
    const resolve = mockToml({ CURRENCIES: [] });

    await resolveAssetMetadata("USD", ISSUER, "one.example");
    await resolveAssetMetadata("USD", ISSUER, "two.example");

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("serves different assets of one issuer from a single fetch", async () => {
    const resolve = mockToml({
      CURRENCIES: [
        { code: "USD", issuer: ISSUER, name: "US Dollar" },
        { code: "EUR", issuer: ISSUER, name: "Euro" },
      ],
    });

    const [usd, eur] = await Promise.all([
      resolveAssetMetadata("USD", ISSUER, "issuer.example"),
      resolveAssetMetadata("EUR", ISSUER, "issuer.example"),
    ]);

    expect(usd.name).toBe("US Dollar");
    expect(eur.name).toBe("Euro");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch, so a later lookup can succeed", async () => {
    const resolve = jest
      .spyOn(StellarToml.Resolver, "resolve")
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        CURRENCIES: [{ code: "USD", issuer: ISSUER, name: "US Dollar" }],
      } as never);

    const first = await resolveAssetMetadata("USD", ISSUER, "issuer.example");
    const second = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(first.name).toBeUndefined();
    expect(second.name).toBe("US Dollar");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("refetches once the cache has been cleared", async () => {
    const resolve = mockToml({ CURRENCIES: [] });

    await resolveAssetMetadata("USD", ISSUER, "issuer.example");
    clearStellarTomlCache();
    await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe("resolveAssetMetadata: fallbacks", () => {
  afterEach(() => {
    clearStellarTomlCache();
    jest.restoreAllMocks();
  });

  it("omits the image when the currency has no icon, keeping the name", async () => {
    mockToml({
      CURRENCIES: [
        { code: "USD", issuer: ISSUER, name: "US Dollar", status: "live" },
      ],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.name).toBe("US Dollar");
    expect(result.image).toBeUndefined();
  });

  it("omits the name when only an icon is present", async () => {
    mockToml({
      CURRENCIES: [
        { code: "USD", issuer: ISSUER, image: "https://x.test/usd.png" },
      ],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.image).toBe("https://x.test/usd.png");
    expect(result.name).toBeUndefined();
  });

  it("ignores a non-string name or image instead of passing it through", async () => {
    mockToml({
      CURRENCIES: [
        { code: "USD", issuer: ISSUER, name: 42, image: { url: "x" } },
      ],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.name).toBeUndefined();
    expect(result.image).toBeUndefined();
    expect(result.code).toBe("USD");
    expect(result.issuer).toBe(ISSUER);
  });

  it("falls back when the toml has no CURRENCIES section", async () => {
    mockToml({});

    await expect(
      resolveAssetMetadata("USD", ISSUER, "issuer.example"),
    ).resolves.toEqual({
      code: "USD",
      issuer: ISSUER,
      verified: false,
    });
  });

  it("falls back when CURRENCIES is empty", async () => {
    mockToml({ CURRENCIES: [] });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.verified).toBe(false);
    expect(result.name).toBeUndefined();
  });

  it("does not match a currency published under a different issuer", async () => {
    mockToml({
      CURRENCIES: [{ code: "USD", issuer: OTHER_ISSUER, name: "Impostor" }],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result).toEqual({ code: "USD", issuer: ISSUER, verified: false });
  });

  it("matches code case-sensitively", async () => {
    mockToml({
      CURRENCIES: [{ code: "usd", issuer: ISSUER, name: "lowercase" }],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.name).toBeUndefined();
    expect(result.verified).toBe(false);
  });

  it("always echoes the requested code and issuer, never the toml's", async () => {
    mockToml({
      CURRENCIES: [{ code: "USD", issuer: ISSUER, name: "US Dollar" }],
    });

    const result = await resolveAssetMetadata("USD", ISSUER, "issuer.example");

    expect(result.code).toBe("USD");
    expect(result.issuer).toBe(ISSUER);
  });
});
