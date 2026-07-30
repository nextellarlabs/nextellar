import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import productsRouter, { deps, generateETag } from "../../backend/routes/products.js";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(productsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /products/:id", () => {
  const app = buildApp();

  afterEach(() => jest.restoreAllMocks());

  it("returns 200 with product data when found", async () => {
    jest
      .spyOn(deps, "getProductById")
      .mockResolvedValue({ id: VALID_UUID, name: "Widget" });

    const res = await request(app).get(`/products/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: VALID_UUID, name: "Widget" });
  });

  it("returns 404 with standard error shape when no product matches the id", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(null);

    const res = await request(app).get(`/products/${VALID_UUID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Product not found");
  });

  it("returns 400 with standard error shape for a non-UUID id", async () => {
    const spy = jest.spyOn(deps, "getProductById");

    const res = await request(app).get("/products/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("INVALID_ID");
    expect(res.body.error.message).toBe("Invalid id format");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 400 for a numeric id", async () => {
    const spy = jest.spyOn(deps, "getProductById");

    const res = await request(app).get("/products/12345");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 500 and does not crash on unexpected DB error", async () => {
    jest
      .spyOn(deps, "getProductById")
      .mockRejectedValue(new Error("DB connection lost"));

    const res = await request(app).get(`/products/${VALID_UUID}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("DB connection lost");
  });
});

describe("GET /products/:id — ETag / Last-Modified caching", () => {
  const app = buildApp();

  afterEach(() => jest.restoreAllMocks());

  const product = { id: VALID_UUID, name: "Widget", updated_at: "2024-01-15T10:00:00.000Z" };

  it("200 response includes ETag and Last-Modified headers", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app).get(`/products/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers["last-modified"]).toBeDefined();
  });

  it("ETag is deterministic — same product yields same ETag", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res1 = await request(app).get(`/products/${VALID_UUID}`);
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);
    const res2 = await request(app).get(`/products/${VALID_UUID}`);

    expect(res1.headers["etag"]).toBe(res2.headers["etag"]);
  });

  it("matching If-None-Match returns 304 with no body", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    // First request to get the ETag
    const first = await request(app).get(`/products/${VALID_UUID}`);
    const etag = first.headers["etag"];

    jest.spyOn(deps, "getProductById").mockResolvedValue(product);
    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-None-Match", etag);

    expect(res.status).toBe(304);
    expect(res.headers["etag"]).toBe(etag);
    expect(res.text).toBe("");
  });

  it("stale If-None-Match returns 200 with updated payload and new ETag", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-None-Match", '"staleETagValue"');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["etag"]).not.toBe('"staleETagValue"');
  });

  it("If-Modified-Since returns 304 when resource not changed since that date", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-Modified-Since", "Mon, 15 Jan 2024 12:00:00 GMT");

    expect(res.status).toBe(304);
    expect(res.headers["etag"]).toBeDefined();
    expect(res.text).toBe("");
  });

  it("If-Modified-Since returns 200 when resource was modified after that date", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-Modified-Since", "Fri, 01 Jan 2021 00:00:00 GMT");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("ETag changes after resource update", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);
    const res1 = await request(app).get(`/products/${VALID_UUID}`);

    const updatedProduct = { ...product, name: "Widget v2", updated_at: "2024-06-01T00:00:00.000Z" };
    jest.spyOn(deps, "getProductById").mockResolvedValue(updatedProduct);
    const res2 = await request(app).get(`/products/${VALID_UUID}`);

    expect(res1.headers["etag"]).not.toBe(res2.headers["etag"]);
  });

  it("malformed If-None-Match is treated as no match — returns 200", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-None-Match", "not-a-valid-etag-format");

    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
  });

  it("product without updated_at omits Last-Modified but still sends ETag", async () => {
    const productNoDate = { id: VALID_UUID, name: "Widget" };
    jest.spyOn(deps, "getProductById").mockResolvedValue(productNoDate);

    const res = await request(app).get(`/products/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBeDefined();
    expect(res.headers["last-modified"]).toBeUndefined();
  });

  it("wildcard If-None-Match (*) returns 304", async () => {
    jest.spyOn(deps, "getProductById").mockResolvedValue(product);

    const res = await request(app)
      .get(`/products/${VALID_UUID}`)
      .set("If-None-Match", "*");

    expect(res.status).toBe(304);
  });

  it("generateETag is stable for identical data", () => {
    const a = generateETag({ id: "1", name: "x" });
    const b = generateETag({ name: "x", id: "1" }); // different key order
    expect(a).toBe(b);
  });
});