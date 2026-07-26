import express, { Request, Response } from "express";
import request from "supertest";
import { localeMiddleware } from "../middleware/locale.js";

function buildApp(options = {}) {
  const app = express();
  app.use(localeMiddleware(options));

  app.get("/test-locale", (req: Request, res: Response) => {
    res.json({
      locale: req.locale,
      contextLocale: req.context?.locale,
    });
  });

  return app;
}

describe("Integration: localeMiddleware", () => {
  const app = buildApp();

  it("attaches negotiated locale to req.locale and req.context.locale on exact match", async () => {
    const res = await request(app)
      .get("/test-locale")
      .set("Accept-Language", "es");

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("es");
    expect(res.body.contextLocale).toBe("es");
  });

  it("resolves regional subtag to base language match", async () => {
    const res = await request(app)
      .get("/test-locale")
      .set("Accept-Language", "fr-FR, fr;q=0.9, en;q=0.8");

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("fr");
    expect(res.body.contextLocale).toBe("fr");
  });

  it("falls back to default locale for unsupported language header", async () => {
    const res = await request(app)
      .get("/test-locale")
      .set("Accept-Language", "zh-CN, ja-JP");

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("en");
    expect(res.body.contextLocale).toBe("en");
  });

  it("falls back to default locale when Accept-Language header is missing", async () => {
    const res = await request(app).get("/test-locale");

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("en");
    expect(res.body.contextLocale).toBe("en");
  });

  it("handles malformed Accept-Language header by falling back gracefully", async () => {
    const res = await request(app)
      .get("/test-locale")
      .set("Accept-Language", ";;;q=invalid, %%%");

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe("en");
    expect(res.body.contextLocale).toBe("en");
  });

  it("respects custom supportedLocales and defaultLocale options", async () => {
    const customApp = buildApp({
      supportedLocales: ["ja", "de"],
      defaultLocale: "de",
    });

    const resJa = await request(customApp)
      .get("/test-locale")
      .set("Accept-Language", "ja");
    expect(resJa.body.locale).toBe("ja");

    const resFallback = await request(customApp)
      .get("/test-locale")
      .set("Accept-Language", "es");
    expect(resFallback.body.locale).toBe("de");
  });
});
