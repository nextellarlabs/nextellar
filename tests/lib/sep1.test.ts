import { StellarToml } from "@stellar/stellar-sdk";
import {
  fetchStellarToml,
  normalizeStellarTomlDomain,
  clearStellarTomlCache,
  StellarTomlError,
} from "../../src/templates/default/src/lib/sep1";

// `StellarToml.Resolver.resolve` already covers HTTP fetching, TOML parsing,
// HTTPS-only enforcement, and max-size enforcement inside the SDK itself —
// spy on just that entry point so `fetchStellarToml` is tested against its
// own normalization/caching/error-wrapping logic, not a reimplementation of
// the SDK's network or parsing behavior.
const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

describe("sep1 (#1050)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    clearStellarTomlCache();
  });

  describe("normalizeStellarTomlDomain", () => {
    it("lowercases a valid domain", () => {
      expect(normalizeStellarTomlDomain("Example.COM")).toBe("example.com");
    });

    it("trims whitespace", () => {
      expect(normalizeStellarTomlDomain("  example.com  ")).toBe("example.com");
    });

    it("accepts a subdomain", () => {
      expect(normalizeStellarTomlDomain("anchor.example.com")).toBe(
        "anchor.example.com",
      );
    });

    it("rejects a URL with a scheme", () => {
      expect(() => normalizeStellarTomlDomain("https://example.com")).toThrow(
        StellarTomlError,
      );
    });

    it("rejects a domain with a path", () => {
      expect(() =>
        normalizeStellarTomlDomain("example.com/.well-known/stellar.toml"),
      ).toThrow(StellarTomlError);
    });

    it("rejects a domain with a port", () => {
      expect(() => normalizeStellarTomlDomain("example.com:8080")).toThrow(
        StellarTomlError,
      );
    });

    it("rejects a domain with userinfo", () => {
      expect(() => normalizeStellarTomlDomain("user:pass@example.com")).toThrow(
        StellarTomlError,
      );
    });

    it("rejects a domain with a query string", () => {
      expect(() => normalizeStellarTomlDomain("example.com?x=1")).toThrow(
        StellarTomlError,
      );
    });

    it("rejects a bare hostname with no TLD label", () => {
      expect(() => normalizeStellarTomlDomain("localhost")).toThrow(
        StellarTomlError,
      );
    });
  });

  describe("fetchStellarToml", () => {
    it("returns the parsed stellar.toml for a valid domain", async () => {
      mockResolve.mockResolvedValue({
        SIGNING_KEY: "GSIGNINGKEY",
        NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      } as never);

      const result = await fetchStellarToml("example.com");

      expect(result.SIGNING_KEY).toBe("GSIGNINGKEY");
      expect(mockResolve).toHaveBeenCalledWith(
        "example.com",
        expect.objectContaining({ allowHttp: undefined }),
      );
    });

    it("normalizes the domain before resolving", async () => {
      mockResolve.mockResolvedValue({} as never);

      await fetchStellarToml("Example.COM");

      expect(mockResolve).toHaveBeenCalledWith(
        "example.com",
        expect.anything(),
      );
    });

    it("rejects a malformed domain without calling the resolver", async () => {
      await expect(fetchStellarToml("not a domain")).rejects.toThrow(
        StellarTomlError,
      );
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it("wraps a resolver failure in StellarTomlError", async () => {
      mockResolve.mockRejectedValue(new Error("network failure"));

      await expect(fetchStellarToml("example.com")).rejects.toThrow(
        StellarTomlError,
      );
      await expect(fetchStellarToml("example.com")).rejects.toThrow(
        /network failure/,
      );
    });

    it("wraps a malformed-TOML failure in StellarTomlError", async () => {
      mockResolve.mockRejectedValue(new Error("Parsing error on line 3"));

      await expect(fetchStellarToml("example.com")).rejects.toThrow(
        /Parsing error/,
      );
    });

    it("caches a successful result for repeated calls", async () => {
      mockResolve.mockResolvedValue({ SIGNING_KEY: "G1" } as never);

      await fetchStellarToml("example.com");
      await fetchStellarToml("example.com");

      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("caches per normalized domain, not per raw input casing", async () => {
      mockResolve.mockResolvedValue({ SIGNING_KEY: "G1" } as never);

      await fetchStellarToml("Example.com");
      await fetchStellarToml("example.COM");

      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("does not cache across different domains", async () => {
      mockResolve
        .mockResolvedValueOnce({ SIGNING_KEY: "G1" } as never)
        .mockResolvedValueOnce({ SIGNING_KEY: "G2" } as never);

      const a = await fetchStellarToml("a.example.com");
      const b = await fetchStellarToml("b.example.com");

      expect(a.SIGNING_KEY).toBe("G1");
      expect(b.SIGNING_KEY).toBe("G2");
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it("refetches once the TTL has elapsed", async () => {
      mockResolve.mockResolvedValue({ SIGNING_KEY: "G1" } as never);

      await fetchStellarToml("example.com", { cacheTtlMs: 10 });
      await new Promise((r) => setTimeout(r, 20));
      await fetchStellarToml("example.com", { cacheTtlMs: 10 });

      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it("bypasses the cache with forceRefresh", async () => {
      mockResolve.mockResolvedValue({ SIGNING_KEY: "G1" } as never);

      await fetchStellarToml("example.com");
      await fetchStellarToml("example.com", { forceRefresh: true });

      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it("does not cache when cacheTtlMs is 0", async () => {
      mockResolve.mockResolvedValue({ SIGNING_KEY: "G1" } as never);

      await fetchStellarToml("example.com", { cacheTtlMs: 0 });
      await fetchStellarToml("example.com", { cacheTtlMs: 0 });

      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it("coalesces concurrent in-flight requests for the same domain", async () => {
      let resolveFn!: (v: StellarToml.Api.StellarToml) => void;
      mockResolve.mockReturnValue(
        new Promise((r) => {
          resolveFn = r;
        }) as never,
      );

      const p1 = fetchStellarToml("example.com");
      const p2 = fetchStellarToml("example.com");
      resolveFn({ SIGNING_KEY: "G1" });

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.SIGNING_KEY).toBe("G1");
      expect(r2.SIGNING_KEY).toBe("G1");
      expect(mockResolve).toHaveBeenCalledTimes(1);
    });

    it("forwards allowHttp and timeout options to the resolver", async () => {
      mockResolve.mockResolvedValue({} as never);

      await fetchStellarToml("example.com", {
        allowHttp: true,
        timeout: 5000,
      });

      expect(mockResolve).toHaveBeenCalledWith("example.com", {
        allowHttp: true,
        timeout: 5000,
      });
    });
  });
});
