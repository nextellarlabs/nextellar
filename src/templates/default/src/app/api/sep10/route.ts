import crypto from "node:crypto";
import { Horizon, Keypair, Networks, StrKey, Utils } from "@stellar/stellar-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
const DEFAULT_JWT_TTL_SECONDS = 86400;
const MIN_JWT_SECRET_LENGTH = 32;
const MAX_UINT64 = 18446744073709551615n;

export interface Sep10Config {
  serverKeypair: Keypair;
  homeDomain: string;
  webAuthDomain: string;
  jwtSecret: string;
  networkPassphrase: string;
  horizonUrl: string;
  challengeTtlSeconds: number;
  jwtTtlSeconds: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads SEP-10 server configuration strictly from environment variables.
 * Returns `null` when required secrets/settings are missing or invalid,
 * keeping the route disabled by default.
 */
export function getSep10Config(
  env: NodeJS.ProcessEnv = process.env,
): Sep10Config | null {
  const signingSeed = env.SEP10_SIGNING_SEED?.trim();
  const homeDomain = env.SEP10_HOME_DOMAIN?.trim();
  const jwtSecret = env.SEP10_JWT_SECRET?.trim();

  if (!signingSeed || !homeDomain || !jwtSecret) {
    return null;
  }

  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    return null;
  }

  if (!StrKey.isValidEd25519SecretSeed(signingSeed)) {
    return null;
  }

  const serverKeypair = Keypair.fromSecret(signingSeed);
  const webAuthDomain = env.SEP10_WEB_AUTH_DOMAIN?.trim() || homeDomain;

  const isMainnet = env.NEXT_PUBLIC_NETWORK?.trim().toLowerCase() === "mainnet";
  const networkPassphrase =
    env.SEP10_NETWORK_PASSPHRASE?.trim() ||
    (isMainnet ? Networks.PUBLIC : Networks.TESTNET);

  const horizonUrl =
    env.SEP10_HORIZON_URL?.trim() ||
    env.NEXT_PUBLIC_HORIZON_URL?.trim() ||
    (isMainnet
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org");

  return {
    serverKeypair,
    homeDomain,
    webAuthDomain,
    jwtSecret,
    networkPassphrase,
    horizonUrl,
    challengeTtlSeconds: parsePositiveInt(
      env.SEP10_CHALLENGE_TTL_SECONDS,
      DEFAULT_CHALLENGE_TTL_SECONDS,
    ),
    jwtTtlSeconds: parsePositiveInt(
      env.SEP10_JWT_TTL_SECONDS,
      DEFAULT_JWT_TTL_SECONDS,
    ),
  };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Signs a SEP-10 JWT using HMAC-SHA256 (HS256) with Node's built-in crypto.
 */
export function createSep10Jwt(
  payload: Record<string, string | number>,
  secret: string,
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function jsonNoStore(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const response = (err as { response?: { status?: number } }).response;
  return response?.status === 404;
}

/**
 * GET /api/sep10?account=<G...|M...>[&memo=<uint64>][&home_domain=<domain>]
 *
 * Issues a SEP-10 challenge transaction signed by the server's signing key.
 */
export async function GET(request: Request): Promise<Response> {
  const config = getSep10Config();
  if (!config) {
    return jsonNoStore(
      { error: "SEP-10 authentication endpoint is not configured." },
      503,
    );
  }

  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account")?.trim();
  const memo = searchParams.get("memo")?.trim() || undefined;
  const requestedHomeDomain = searchParams.get("home_domain")?.trim();

  if (!account) {
    return jsonNoStore({ error: "Missing required 'account' parameter." }, 400);
  }

  const isGAccount = StrKey.isValidEd25519PublicKey(account);
  const isMAccount = StrKey.isValidMed25519PublicKey(account);

  if (!isGAccount && !isMAccount) {
    return jsonNoStore({ error: "Invalid Stellar 'account' parameter." }, 400);
  }

  if (memo !== undefined) {
    if (isMAccount) {
      return jsonNoStore(
        { error: "The 'memo' parameter cannot be used with muxed accounts." },
        400,
      );
    }
    if (!/^\d+$/.test(memo) || BigInt(memo) > MAX_UINT64) {
      return jsonNoStore(
        { error: "Invalid 'memo' parameter; expected a 64-bit unsigned integer." },
        400,
      );
    }
  }

  if (requestedHomeDomain && requestedHomeDomain !== config.homeDomain) {
    return jsonNoStore(
      { error: "Requested 'home_domain' is not supported by this server." },
      400,
    );
  }

  const transaction = Utils.buildChallengeTx(
    config.serverKeypair,
    account,
    config.homeDomain,
    config.challengeTtlSeconds,
    config.networkPassphrase,
    config.webAuthDomain,
    memo,
  );

  return jsonNoStore(
    {
      transaction,
      network_passphrase: config.networkPassphrase,
    },
    200,
  );
}

async function extractTransactionParam(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formText = await request.text();
    const params = new URLSearchParams(formText);
    const tx = params.get("transaction")?.trim();
    return tx || null;
  }

  try {
    const body = (await request.json()) as { transaction?: unknown };
    if (typeof body?.transaction === "string" && body.transaction.trim()) {
      return body.transaction.trim();
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * POST /api/sep10
 *
 * Verifies a client-signed SEP-10 challenge transaction and returns a JWT.
 */
export async function POST(request: Request): Promise<Response> {
  const config = getSep10Config();
  if (!config) {
    return jsonNoStore(
      { error: "SEP-10 authentication endpoint is not configured." },
      503,
    );
  }

  const transaction = await extractTransactionParam(request);
  if (!transaction) {
    return jsonNoStore(
      { error: "Missing or invalid 'transaction' field in request body." },
      400,
    );
  }

  let parsed: ReturnType<typeof Utils.readChallengeTx>;
  try {
    parsed = Utils.readChallengeTx(
      transaction,
      config.serverKeypair.publicKey(),
      config.networkPassphrase,
      config.homeDomain,
      config.webAuthDomain,
    );
  } catch {
    return jsonNoStore({ error: "Invalid SEP-10 challenge transaction." }, 400);
  }

  const { tx, clientAccountID, memo } = parsed;

  try {
    const horizon = new Horizon.Server(config.horizonUrl);
    let accountRecord: Horizon.AccountResponse | null = null;

    try {
      accountRecord = await horizon.loadAccount(clientAccountID);
    } catch (err) {
      if (!isNotFoundError(err)) {
        return jsonNoStore(
          { error: "Unable to verify account signers against Horizon." },
          502,
        );
      }
    }

    if (accountRecord) {
      const requiredThreshold = Math.max(
        1,
        accountRecord.thresholds.med_threshold,
      );
      Utils.verifyChallengeTxThreshold(
        transaction,
        config.serverKeypair.publicKey(),
        config.networkPassphrase,
        requiredThreshold,
        accountRecord.signers,
        config.homeDomain,
        config.webAuthDomain,
      );
    } else {
      Utils.verifyChallengeTxSigners(
        transaction,
        config.serverKeypair.publicKey(),
        config.networkPassphrase,
        [clientAccountID],
        config.homeDomain,
        config.webAuthDomain,
      );
    }
  } catch {
    return jsonNoStore(
      { error: "Challenge transaction signature verification failed." },
      400,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const sub = memo ? `${clientAccountID}:${memo}` : clientAccountID;
  const token = createSep10Jwt(
    {
      iss: `https://${config.webAuthDomain}`,
      sub,
      iat: now,
      exp: now + config.jwtTtlSeconds,
      jti: tx.hash().toString("hex"),
    },
    config.jwtSecret,
  );

  return jsonNoStore({ token }, 200);
}
