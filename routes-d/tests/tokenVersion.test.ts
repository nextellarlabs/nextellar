import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { requireJwt } from "../middleware/jwt.js";
import { tokenVersionStore } from "../auth/tokenVersion.js";

const SECRET = "nextellar-routes-d-jwt-secret";
const ISSUER = "nextellar";
const AUDIENCE = "nextellar-app";

function sign(payload: object) {
  return jwt.sign(payload, SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

function buildApp() {
  const app = express();
  app.get("/me", requireJwt(), (req, res) =>
    res.status(200).json({ ok: true, sub: req.jwt?.sub, tv: req.jwt?.tv }),
  );
  return app;
}

beforeEach(() => {
  tokenVersionStore.reset();
});

describe("Token version store + JWT revocation on password change (#262)", () => {
  it("starts at version 0 and bumps monotonically", () => {
    expect(tokenVersionStore.current("user-1")).toBe(0);
    expect(tokenVersionStore.bump("user-1").version).toBe(1);
    expect(tokenVersionStore.bump("user-1").version).toBe(2);
    expect(tokenVersionStore.current("user-1")).toBe(2);
  });

  it("rejects an invalid user id", () => {
    expect(() => tokenVersionStore.bump("")).toThrow("invalid_user_id");
  });

  it("does not affect other users", () => {
    tokenVersionStore.bump("user-1");
    expect(tokenVersionStore.current("user-1")).toBe(1);
    expect(tokenVersionStore.current("user-2")).toBe(0);
  });

  it("rejects an old token after the password is changed", async () => {
    const oldToken = sign({ sub: "user-1", tv: 0 });

    // Sanity-check: old token is accepted before any bump.
    const before = await request(buildApp())
      .get("/me")
      .set("authorization", `Bearer ${oldToken}`);
    expect(before.status).toBe(200);

    // Password change → bump.
    tokenVersionStore.bump("user-1");

    const after = await request(buildApp())
      .get("/me")
      .set("authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ error: "unauthorized" });
  });

  it("accepts a re-signed token that carries the new version", async () => {
    tokenVersionStore.bump("user-1");
    const fresh = sign({ sub: "user-1", tv: 1 });
    const res = await request(buildApp())
      .get("/me")
      .set("authorization", `Bearer ${fresh}`);
    expect(res.status).toBe(200);
    expect(res.body.tv).toBe(1);
  });

  it("rejects a token missing tv after a bump", async () => {
    tokenVersionStore.bump("user-1");
    const noTv = sign({ sub: "user-1" });
    const res = await request(buildApp())
      .get("/me")
      .set("authorization", `Bearer ${noTv}`);
    expect(res.status).toBe(401);
  });
});
