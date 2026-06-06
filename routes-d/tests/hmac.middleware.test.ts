import request from "supertest";
import express from "express";
import { buildCanonicalSigningString, createHmacMiddleware, sha256Base64, signCanonicalString } from "../middleware/hmac.js";

describe("routes-d hmac middleware", () => {
  const secret = "test-secret";

  function buildApp(now: number) {
    const app = express();
    app.use(express.json());
    app.post("/secure", createHmacMiddleware({ secret, now: () => now, maxSkewMs: 300000 }), (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  function signedHeaders(now: number, body: unknown, nonce = "n-1") {
    const timestamp = String(now);
    const canonical = buildCanonicalSigningString({ method: "POST", path: "/secure", timestamp, nonce, bodyHash: sha256Base64(JSON.stringify(body)) });
    return { "x-timestamp": timestamp, "x-nonce": nonce, "x-signature": signCanonicalString(secret, canonical) };
  }

  it("accepts valid signed requests", async () => {
    const now = Date.now();
    const app = buildApp(now);
    const body = { amount: 10 };
    const res = await request(app).post("/secure").set(signedHeaders(now, body)).send(body);
    expect(res.status).toBe(200);
  });

  it("rejects expired timestamps", async () => {
    const now = Date.now();
    const app = buildApp(now + 600000);
    const body = { amount: 10 };
    const res = await request(app).post("/secure").set(signedHeaders(now, body)).send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("hmac_expired_request");
  });

  it("rejects replayed nonces", async () => {
    const now = Date.now();
    const app = buildApp(now);
    const body = { amount: 10 };
    await request(app).post("/secure").set(signedHeaders(now, body, "nonce-123")).send(body);
    const replay = await request(app).post("/secure").set(signedHeaders(now, body, "nonce-123")).send(body);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("hmac_replay_detected");
  });

  it("rejects tampered body", async () => {
    const now = Date.now();
    const app = buildApp(now);
    const headers = signedHeaders(now, { amount: 10 }, "nonce-t");
    const res = await request(app).post("/secure").set(headers).send({ amount: 11 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("hmac_signature_mismatch");
  });
});
