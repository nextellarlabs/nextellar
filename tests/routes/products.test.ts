import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import productsRouter, { deps } from "../../backend/routes/products.js";

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
