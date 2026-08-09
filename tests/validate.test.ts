import {
  isValidUrl,
  validateHorizonUrl,
  validateSorobanUrl,
  validateProjectName,
  suggestProjectName,
} from "../src/lib/validate";

describe("URL validation utilities", () => {
  describe("isValidUrl", () => {
    it("returns true for valid HTTPS URLs", () => {
      expect(isValidUrl("https://horizon-testnet.stellar.org")).toBe(true);
    });

    it("returns true for valid HTTP URLs", () => {
      expect(isValidUrl("http://localhost:8000")).toBe(true);
    });

    it("returns true for URLs with ports", () => {
      expect(isValidUrl("https://horizon.example.com:8443")).toBe(true);
    });

    it("returns true for URLs with trailing slashes", () => {
      expect(isValidUrl("https://horizon.stellar.org/")).toBe(true);
    });

    it("returns false when protocol is missing", () => {
      expect(isValidUrl("horizon-testnet.stellar.org")).toBe(false);
    });

    it("returns false for malformed URLs", () => {
      expect(isValidUrl("htps://horizon.stellar.org")).toBe(false);
    });

    it("returns false for non-http schemes", () => {
      expect(isValidUrl("ftp://horizon.stellar.org")).toBe(false);
    });

    it("returns false for empty strings", () => {
      expect(isValidUrl("")).toBe(false);
    });

    it("returns false for whitespace-only strings", () => {
      expect(isValidUrl("   ")).toBe(false);
    });
  });

  describe("validateHorizonUrl", () => {
    it("does not throw for a valid Horizon URL", () => {
      expect(() =>
        validateHorizonUrl("https://horizon-testnet.stellar.org"),
      ).not.toThrow();
    });

    it("throws a descriptive error for an invalid Horizon URL", () => {
      expect(() => validateHorizonUrl("invalid-url")).toThrow(
        'Invalid Horizon URL: "invalid-url"',
      );
    });
  });

  describe("validateSorobanUrl", () => {
    it("does not throw for a valid Soroban URL", () => {
      expect(() =>
        validateSorobanUrl("https://soroban-testnet.stellar.org"),
      ).not.toThrow();
    });

    it("throws a descriptive error for an invalid Soroban URL", () => {
      expect(() => validateSorobanUrl("invalid-url")).toThrow(
        'Invalid Soroban URL: "invalid-url"',
      );
    });
  });
});

describe("Project name validation (npm package naming rules)", () => {
  describe("validateProjectName", () => {
    it("accepts a simple lowercase name", () => {
      expect(() => validateProjectName("my-app")).not.toThrow();
    });

    it("accepts a scoped package name", () => {
      expect(() => validateProjectName("@scope/my-app")).not.toThrow();
    });

    it("accepts a name with numbers", () => {
      expect(() => validateProjectName("app123")).not.toThrow();
    });

    it("accepts a single-character name", () => {
      expect(() => validateProjectName("a")).not.toThrow();
    });

    it("rejects uppercase names", () => {
      expect(() => validateProjectName("MyApp")).toThrow(
        'Invalid project name: "MyApp"',
      );
    });

    it("rejects names with spaces", () => {
      expect(() => validateProjectName("My App")).toThrow(
        'Invalid project name: "My App"',
      );
    });

    it("rejects names with a leading dot", () => {
      expect(() => validateProjectName(".hidden-project")).toThrow(
        'Invalid project name: ".hidden-project"',
      );
    });

    it("rejects names with a leading underscore", () => {
      expect(() => validateProjectName("_private-project")).toThrow(
        'Invalid project name: "_private-project"',
      );
    });

    it("rejects names longer than 214 characters", () => {
      const longName = "a".repeat(215);
      expect(() => validateProjectName(longName)).toThrow(
        `Invalid project name: "${longName}"`,
      );
    });

    it("rejects empty string", () => {
      expect(() => validateProjectName("")).toThrow(
        "Project name is required",
      );
    });

    it("rejects whitespace-only string", () => {
      expect(() => validateProjectName("   ")).toThrow(
        "Project name is required",
      );
    });

    it("rejects names with special characters", () => {
      expect(() => validateProjectName("my@app!")).toThrow(
        'Invalid project name: "my@app!"',
      );
    });

    it("includes a suggestion when a slug can be derived", () => {
      expect(() => validateProjectName("My App")).toThrow(
        'Did you mean:\n\nmy-app',
      );
    });

    it("includes a suggestion for uppercase names", () => {
      expect(() => validateProjectName("MyApp")).toThrow(
        'Did you mean:\n\nmyapp',
      );
    });

    it("traversal validation remains delegated to #111", () => {
      // Path traversal/containment validation of target directory is not performed
      // by validateProjectName (which focuses strictly on npm package-name rules)
      // but remains delegated to the scaffolding/add level.
      expect(() => validateProjectName("my-app")).not.toThrow();
    });
  });

  describe("suggestProjectName", () => {
    it("lowercases and hyphenates spaces", () => {
      expect(suggestProjectName("My App")).toBe("my-app");
    });

    it("lowercases mixed-case names", () => {
      expect(suggestProjectName("MyApp")).toBe("myapp");
    });

    it("strips invalid characters", () => {
      expect(suggestProjectName("my_app!@#")).toBe("myapp");
    });

    it("handles names with multiple spaces", () => {
      expect(suggestProjectName("My  Cool  App")).toBe("my-cool-app");
    });

    it("returns null for names that reduce to empty string", () => {
      expect(suggestProjectName("!!!")).toBeNull();
    });

    it("trims leading/trailing whitespace before slugifying", () => {
      expect(suggestProjectName("  My App  ")).toBe("my-app");
    });

    it("handles names with leading dots by stripping them", () => {
      expect(suggestProjectName(".hidden")).toBe("hidden");
    });

    it("handles names with leading underscores by stripping them", () => {
      expect(suggestProjectName("_private")).toBe("private");
    });
  });
});
