/**
 * Integration tests for POST /admin/users/import
 *
 * Mounts the router on a real Express app via supertest.
 *
 * Covers:
 *  - Happy path (all rows valid → 200)
 *  - Partial failure (mix of valid/invalid rows → 207)
 *  - Repeat upload (same CSV twice → 200 with duplicate=true)
 *  - Auth failures (missing operator, missing scope)
 *  - Malformed payloads (empty body, missing columns, invalid JSON)
 */

import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetImportedUsers,
  __resetImportStore,
} from "../../routes/admin.users.import.js";

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  // NOTE: we deliberately do NOT attach express.json() globally so the route
  // can handle its own raw body reading for text/csv.
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function makeCsv(...rows: string[]): string {
  return ["email,firstname,lastname,country,role", ...rows].join("\n");
}

const VALID_ROW = "alice@example.com,Alice,Smith,US,user";
const VALID_ROW_2 = "bob@example.com,Bob,Jones,GB,partner";
const INVALID_ROW = "bad-email,Bad,User,US,user";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const app = buildApp();

beforeEach(() => {
  __resetImportStore();
  __resetImportedUsers();
});

// ---------------------------------------------------------------------------
// Auth guard tests
// ---------------------------------------------------------------------------

describe("POST /admin/users/import – auth", () => {
  it("returns 401 when x-operator-id header is missing", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .send(makeCsv(VALID_ROW));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when operator does not have the import scope", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "read,freeze")
      .send(makeCsv(VALID_ROW));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /admin/users/import – happy path", () => {
  it("accepts a valid CSV and returns 200 with all rows accepted", async () => {
    const csv = makeCsv(VALID_ROW, VALID_ROW_2);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.data.rejected).toBe(0);
    expect(res.body.data.duplicate).toBe(false);
    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.data.results[0].status).toBe("accepted");
  });

  it("includes a stable content hash in the response", async () => {
    const csv = makeCsv(VALID_ROW);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.body.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a JSON-wrapped CSV body", async () => {
    const csv = makeCsv(VALID_ROW);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "application/json")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(JSON.stringify({ csv }));

    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(1);
  });

  it("includes the submittedBy operator in the response", async () => {
    const csv = makeCsv(VALID_ROW);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "operator-xyz")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.body.data.submittedBy).toBe("operator-xyz");
  });
});

// ---------------------------------------------------------------------------
// Partial failure
// ---------------------------------------------------------------------------

describe("POST /admin/users/import – partial failure", () => {
  it("returns 207 when at least one row is rejected", async () => {
    const csv = makeCsv(VALID_ROW, INVALID_ROW);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.status).toBe(207);
    expect(res.body.data.accepted).toBe(1);
    expect(res.body.data.rejected).toBe(1);
  });

  it("includes per-row error details for rejected rows", async () => {
    const csv = makeCsv(INVALID_ROW);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    const rejected = res.body.data.results.filter(
      (r: { status: string }) => r.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].errors).toBeDefined();
    expect(Array.isArray(rejected[0].errors)).toBe(true);
    expect(rejected[0].errors.length).toBeGreaterThan(0);
  });

  it("still reports accepted rows alongside rejected ones", async () => {
    const csv = makeCsv(VALID_ROW, INVALID_ROW, VALID_ROW_2);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    const accepted = res.body.data.results.filter(
      (r: { status: string }) => r.status === "accepted",
    );
    expect(accepted).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Repeat upload (idempotency)
// ---------------------------------------------------------------------------

describe("POST /admin/users/import – repeat upload", () => {
  it("returns duplicate=true on a second identical upload", async () => {
    const csv = makeCsv(VALID_ROW);

    await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.data.duplicate).toBe(true);
  });

  it("returns the same contentHash for both calls", async () => {
    const csv = makeCsv(VALID_ROW_2);

    const first = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    const second = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(first.body.data.contentHash).toBe(second.body.data.contentHash);
  });

  it("treats a different CSV as a new, non-duplicate import", async () => {
    const csv1 = makeCsv("carol@example.com,Carol,White,DE,user");
    const csv2 = makeCsv("dave@example.com,Dave,Brown,AU,user");

    await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv1);

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv2);

    expect(res.body.data.duplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed / edge-case payloads
// ---------------------------------------------------------------------------

describe("POST /admin/users/import – malformed payloads", () => {
  it("returns 400 for an empty body", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send("");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_PAYLOAD");
  });

  it("returns 422 for a CSV missing required columns", async () => {
    const csv = "name,address\nAlice,123 Main St\n";

    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "text/csv")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(csv);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MISSING_CSV_COLUMNS");
  });

  it("returns 400 for an invalid JSON body", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "application/json")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send("{not valid json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 400 for a JSON body missing the csv field", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "application/json")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send(JSON.stringify({ data: "something else" }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CSV_FIELD");
  });

  it("returns 415 for an unsupported content type", async () => {
    const res = await request(app)
      .post("/admin/users/import")
      .set("Content-Type", "application/xml")
      .set("x-operator-id", "op-1")
      .set("x-operator-scopes", "import")
      .send("<users></users>");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });
});
