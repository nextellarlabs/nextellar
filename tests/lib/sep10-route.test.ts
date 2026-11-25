import crypto from "node:crypto";
import {
  Horizon,
  Keypair,
  Networks,
  Transaction,
  Utils,
} from "@stellar/stellar-sdk";
import {
  GET,
  POST,
  createSep10Jwt,
  getSep10Config,
} from "../../src/templates/default/src/app/api/sep10/route";

const HOME_DOMAIN = "example.com";
const WEB_AUTH_DOMAIN = "auth.example.com";
const JWT_SECRET = "super-secret-jwt-key-at-least-32-chars-long";

const serverKp = Keypair.random();
const clientKp = Keypair.random();

const ENV_KEYS = [
  "SEP10_SIGNING_SEED",
  "SEP10_HOME_DOMAIN",
  "SEP10_WEB_AUTH_DOMAIN",
  "SEP10_JWT_SECRET",
  "SEP10_NETWORK_PASSPHRASE",
  "SEP10_HORIZON_URL",
  "SEP10_CHALLENGE_TTL_SECONDS",
  "SEP10_JWT_TTL_SECONDS",
  "NEXT_PUBLIC_NETWORK",
  "NEXT_PUBLIC_HORIZON_URL",
] as const;

function clearSep10Env() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function setValidSep10Env() {
  process.env.SEP10_SIGNING_SEED = serverKp.secret();
  process.env.SEP10_HOME_DOMAIN = HOME_DOMAIN;
  process.env.SEP10_WEB_AUTH_DOMAIN = WEB_AUTH_DOMAIN;
  process.env.SEP10_JWT_SECRET = JWT_SECRET;
  process.env.SEP10_NETWORK_PASSPHRASE = Networks.TESTNET;
}

describe("SEP-10 route (/api/sep10)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearSep10Env();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    clearSep10Env();
    Object.assign(process.env, originalEnv);
  });

  describe("configuration and disabled-by-default behavior", () => {
    it("returns null config and 503 when env vars are missing", async () => {
      expect(getSep10Config()).toBeNull();

      const getRes = await GET(
        new Request(
          `https://auth.example.com/api/sep10?account=${clientKp.publicKey()}`,
        ),
      );
      expect(getRes.status).toBe(503);
      expect(getRes.headers.get("cache-control")).toBe("no-store");

      const postRes = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: "AAAA" }),
        }),
      );
      expect(postRes.status).toBe(503);
    });

    it("disables the route when signing seed is invalid or JWT secret is too short", () => {
      setValidSep10Env();
      process.env.SEP10_SIGNING_SEED = "NOT_A_VALID_SEED";
      expect(getSep10Config()).toBeNull();

      setValidSep10Env();
      process.env.SEP10_JWT_SECRET = "too-short";
      expect(getSep10Config()).toBeNull();
    });
  });

  describe("GET /api/sep10", () => {
    beforeEach(() => {
      setValidSep10Env();
    });

    it("rejects missing or invalid query parameters", async () => {
      const missingAccount = await GET(
        new Request("https://auth.example.com/api/sep10"),
      );
      expect(missingAccount.status).toBe(400);

      const invalidAccount = await GET(
        new Request("https://auth.example.com/api/sep10?account=INVALID"),
      );
      expect(invalidAccount.status).toBe(400);

      const invalidMemo = await GET(
        new Request(
          `https://auth.example.com/api/sep10?account=${clientKp.publicKey()}&memo=abc`,
        ),
      );
      expect(invalidMemo.status).toBe(400);

      const wrongDomain = await GET(
        new Request(
          `https://auth.example.com/api/sep10?account=${clientKp.publicKey()}&home_domain=evil.com`,
        ),
      );
      expect(wrongDomain.status).toBe(400);
    });

    it("issues a valid SEP-10 challenge transaction", async () => {
      const res = await GET(
        new Request(
          `https://auth.example.com/api/sep10?account=${clientKp.publicKey()}&memo=42`,
        ),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const data = (await res.json()) as {
        transaction: string;
        network_passphrase: string;
      };
      expect(data.network_passphrase).toBe(Networks.TESTNET);

      const parsed = Utils.readChallengeTx(
        data.transaction,
        serverKp.publicKey(),
        Networks.TESTNET,
        HOME_DOMAIN,
        WEB_AUTH_DOMAIN,
      );
      expect(parsed.clientAccountID).toBe(clientKp.publicKey());
      expect(parsed.memo).toBe("42");
    });
  });

  describe("POST /api/sep10", () => {
    beforeEach(() => {
      setValidSep10Env();
    });

    it("rejects missing transaction or unsigned challenge", async () => {
      const missing = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      expect(missing.status).toBe(400);

      const challenge = Utils.buildChallengeTx(
        serverKp,
        clientKp.publicKey(),
        HOME_DOMAIN,
        300,
        Networks.TESTNET,
        WEB_AUTH_DOMAIN,
      );

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockRejectedValue({ response: { status: 404 } });

      const unsigned = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: challenge }),
        }),
      );
      expect(unsigned.status).toBe(400);
    });

    it("verifies a signed challenge for an unfunded account and issues an HS256 JWT", async () => {
      const challenge = Utils.buildChallengeTx(
        serverKp,
        clientKp.publicKey(),
        HOME_DOMAIN,
        300,
        Networks.TESTNET,
        WEB_AUTH_DOMAIN,
      );
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(clientKp);

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockRejectedValue({ response: { status: 404 } });

      const res = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: tx.toXDR() }),
        }),
      );
      expect(res.status).toBe(200);

      const { token } = (await res.json()) as { token: string };
      const [headerB64, payloadB64, sigB64] = token.split(".");
      const expectedSig = crypto
        .createHmac("sha256", JWT_SECRET)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      expect(sigB64).toBe(expectedSig);

      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      expect(payload.iss).toBe(`https://${WEB_AUTH_DOMAIN}`);
      expect(payload.sub).toBe(clientKp.publicKey());
      expect(payload.jti).toBe(tx.hash().toString("hex"));
    });

    it("verifies a signed challenge for a funded account via form-urlencoded body", async () => {
      const challenge = Utils.buildChallengeTx(
        serverKp,
        clientKp.publicKey(),
        HOME_DOMAIN,
        300,
        Networks.TESTNET,
        WEB_AUTH_DOMAIN,
      );
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(clientKp);

      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue({
        thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 },
        signers: [
          { key: clientKp.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      } as unknown as Horizon.AccountResponse);

      const res = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ transaction: tx.toXDR() }).toString(),
        }),
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string };
      expect(typeof data.token).toBe("string");
    });

    it("returns 502 when Horizon fails with a non-404 error", async () => {
      const challenge = Utils.buildChallengeTx(
        serverKp,
        clientKp.publicKey(),
        HOME_DOMAIN,
        300,
        Networks.TESTNET,
        WEB_AUTH_DOMAIN,
      );
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(clientKp);

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockRejectedValue(new Error("Horizon unavailable"));

      const res = await POST(
        new Request("https://auth.example.com/api/sep10", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction: tx.toXDR() }),
        }),
      );
      expect(res.status).toBe(502);
    });
  });

  it("createSep10Jwt produces a 3-part JWT", () => {
    const token = createSep10Jwt({ sub: "GABC" }, JWT_SECRET);
    expect(token.split(".")).toHaveLength(3);
  });
});
