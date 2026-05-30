import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { requireJwt } from "../middleware/jwt.js";
import { tokenVersionStore } from "../auth/tokenVersion.js";

const SECRET = "nextellar-routes-d-jwt-secret";
const ISSUER = "nextellar";
const AUDIENCE = "nextellar-app";

function sign(payload: object, opts: jwt.SignOptions = {}) {
  return jwt.sign(payload, SECRET, {
    algorithm: "HS256",
    issuer: ISSUER,
    audience: AUDIENCE,
    ...opts,
  });
}

function buildApp(scopes?: string[]) {
  const app = express();
  app.get("/protected", requireJwt({ scopes }), (req, res) => {
    res.status(200).json({ ok: true, sub: req.jwt?.sub });
  });
  return app;
}

beforeEach(() => {
  tokenVersionStore.reset();
});

describe("JWT validation middleware (#261)", () => {
  it("rejects requests without an Authorization header", async () => {
    const res = await request(buildApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("rejects an expired token with a generic 401", async () => {
    const token = sign({ sub: "user-1" }, { expiresIn: "-1h" });
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("rejects a tampered token", async () => {
    const token = sign({ sub: "user-1" }) + "x";
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign({ sub: "user-1" }, "wrong-secret", {
      algorithm: "HS256",
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token with the wrong audience", async () => {
    const token = sign({ sub: "user-1" }, { audience: "wrong-app" });
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = sign({ sub: "user-1" }, { issuer: "wrong" });
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and exposes claims on req.jwt", async () => {
    const token = sign({ sub: "user-1" });
    const res = await request(buildApp())
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sub: "user-1" });
  });

  it("returns 403 when required scopes are missing", async () => {
    const token = sign({ sub: "user-1", scopes: ["read"] });
    const res = await request(buildApp(["transfer:write"]))
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
  });

  it("accepts a valid token when all required scopes are present", async () => {
    const token = sign({
      sub: "user-1",
      scopes: ["read", "transfer:write"],
    });
    const res = await request(buildApp(["transfer:write"]))
      .get("/protected")
      .set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
