const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("token module startup", () => {
  it("throws on import when JWT_SECRET is not set", async () => {
    delete process.env.JWT_SECRET;
    await expect(import("../../backend/auth/token")).rejects.toThrow(
      "Missing required environment variable: JWT_SECRET",
    );
  });

  it("loads successfully when JWT_SECRET is set", async () => {
    process.env.JWT_SECRET = "test-secret-value";
    await expect(import("../../backend/auth/token")).resolves.toBeDefined();
  });
});

describe("signToken / verifyToken", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-value";
  });

  it("signs and verifies a token round-trip", async () => {
    const { signToken, verifyToken } = await import("../../backend/auth/token");

    const token = signToken({ sub: "user-123", role: "admin" });
    const payload = verifyToken(token);

    expect(payload.sub).toBe("user-123");
    expect(payload.role).toBe("admin");
  });

  it("throws when verifying a token signed with a different secret", async () => {
    const { signToken } = await import("../../backend/auth/token");
    const token = signToken({ sub: "user-123", role: "user" });

    // Re-load module with a different secret
    jest.resetModules();
    process.env.JWT_SECRET = "completely-different-secret";
    const { verifyToken: verifyWithOtherSecret } =
      await import("../../backend/auth/token");

    expect(() => verifyWithOtherSecret(token)).toThrow();
  });
});
