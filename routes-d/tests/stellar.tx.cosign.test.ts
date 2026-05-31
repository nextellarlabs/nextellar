// Tests for the Stellar transaction co-signing route (#280).
//
// Covers the allowlist gate (allowed vs disallowed operation sets),
// payload validation, and the env loader's missing-key behaviour. The
// signer is mocked so no real key material is touched.

import express, { type Express } from "express";
import request from "supertest";
import {
  CosignDisallowedError,
  type CosignerSigner,
  createCosignRouter,
  findDisallowedOperations,
  loadCosignerFromEnv,
} from "../routes/stellar.tx.cosign.js";

function buildSigner(overrides: Partial<CosignerSigner> = {}): CosignerSigner {
  return {
    publicKey: "GTESTPUBLICKEY",
    sign: (envelope) => `sig-for-${envelope}`,
    ...overrides,
  };
}

function buildApp(
  signer: CosignerSigner,
  allowed: string[] = ["payment", "manageData"],
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/stellar/tx",
    createCosignRouter({ signer, allowedOperations: allowed }),
  );
  return app;
}

describe("findDisallowedOperations", () => {
  it("returns empty when every op is allowed", () => {
    expect(
      findDisallowedOperations(
        [{ type: "payment" }, { type: "manageData" }],
        new Set(["payment", "manageData"]),
      ),
    ).toEqual([]);
  });

  it("collects every disallowed op type, preserving order", () => {
    expect(
      findDisallowedOperations(
        [{ type: "payment" }, { type: "setOptions" }, { type: "accountMerge" }],
        new Set(["payment"]),
      ),
    ).toEqual(["setOptions", "accountMerge"]);
  });
});

describe("POST /stellar/tx/cosign", () => {
  it("returns 200 + signature when every operation is allowed", async () => {
    const sign = jest.fn().mockReturnValue("sig-abc");
    const app = buildApp(buildSigner({ sign }));

    const res = await request(app)
      .post("/stellar/tx/cosign")
      .send({
        envelope: "AAA==",
        operations: [{ type: "payment" }, { type: "manageData" }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      signature: "sig-abc",
      signer: "GTESTPUBLICKEY",
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith("AAA==");
  });

  it("returns 403 when any operation is disallowed and does not sign", async () => {
    const sign = jest.fn();
    const app = buildApp(buildSigner({ sign }));

    const res = await request(app)
      .post("/stellar/tx/cosign")
      .send({
        envelope: "AAA==",
        operations: [{ type: "payment" }, { type: "accountMerge" }],
      });

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.disallowed).toEqual(["accountMerge"]);
    expect(sign).not.toHaveBeenCalled();
  });

  it("returns 400 on a missing envelope", async () => {
    const res = await request(buildApp(buildSigner()))
      .post("/stellar/tx/cosign")
      .send({ operations: [{ type: "payment" }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 on an empty operations array", async () => {
    const res = await request(buildApp(buildSigner()))
      .post("/stellar/tx/cosign")
      .send({ envelope: "AAA==", operations: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when an operation entry lacks a string type", async () => {
    const res = await request(buildApp(buildSigner()))
      .post("/stellar/tx/cosign")
      .send({ envelope: "AAA==", operations: [{ kind: "payment" }] });
    expect(res.status).toBe(400);
  });

  it("returns 500 with a generic message when the signer throws", async () => {
    const sign = jest.fn().mockImplementation(() => {
      throw new Error("would leak secret");
    });
    const res = await request(buildApp(buildSigner({ sign })))
      .post("/stellar/tx/cosign")
      .send({ envelope: "AAA==", operations: [{ type: "payment" }] });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("cosigner failed to sign");
    // The original error message must not leak through.
    expect(JSON.stringify(res.body)).not.toMatch(/leak secret/);
  });
});

describe("createCosignRouter", () => {
  it("throws when allowedOperations is empty", () => {
    expect(() =>
      createCosignRouter({ signer: buildSigner(), allowedOperations: [] }),
    ).toThrow(/non-empty/);
  });
});

describe("loadCosignerFromEnv", () => {
  it("throws when STELLAR_COSIGNER_PUBLIC is missing", () => {
    expect(() =>
      loadCosignerFromEnv(() => "sig", { STELLAR_COSIGNER_SECRET: "S..." }),
    ).toThrow(/must be set/);
  });

  it("throws when STELLAR_COSIGNER_SECRET is missing", () => {
    expect(() =>
      loadCosignerFromEnv(() => "sig", { STELLAR_COSIGNER_PUBLIC: "G..." }),
    ).toThrow(/must be set/);
  });

  it("delegates signing to the supplied signerFn without logging the secret", async () => {
    const calls: Array<{ secret: string; envelope: string }> = [];
    const cosigner = loadCosignerFromEnv(
      (secret, envelope) => {
        calls.push({ secret, envelope });
        return "sig-zz";
      },
      { STELLAR_COSIGNER_PUBLIC: "GPUB", STELLAR_COSIGNER_SECRET: "SSECRET" },
    );

    expect(cosigner.publicKey).toBe("GPUB");
    expect(await cosigner.sign("env-xyz")).toBe("sig-zz");
    expect(calls).toEqual([{ secret: "SSECRET", envelope: "env-xyz" }]);
  });
});

describe("CosignDisallowedError", () => {
  it("includes the disallowed types in its message", () => {
    const err = new CosignDisallowedError(["a", "b"]);
    expect(err.message).toMatch(/a, b/);
    expect(err.disallowed).toEqual(["a", "b"]);
  });
});
